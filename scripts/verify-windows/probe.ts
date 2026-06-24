import type { Page } from 'playwright-core';
import type { ProfileObservation, RawObservation } from './types';

/** Metadata the orchestrator pairs with the in-page measurement. */
export interface ProfileMeta {
  profileId: string;
  profileName: string;
  seed: number;
}

/**
 * The in-page probe. Serialized and run inside the profile's browser window, so
 * it must be fully self-contained (no closure over module scope). Captures the
 * richer vector set from the design: canvas/audio/font/WebGL (as fingerprint-probe
 * does) PLUS clientRects hash, UA-Client-Hints high-entropy values, selected
 * WebGL getParameter values, screen avail/pixelDepth, and timezone offset.
 *
 * Reads only navigator/screen/WebGL/canvas/audio/DOM-layout — all available on
 * the default about:blank page, so the default run never navigates and leaves no
 * third-party traces.
 */
async function probeInPage(): Promise<RawObservation> {
  const hashString = (input: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };

  // --- canvas (2D) ---
  const canvasSummary = (): { hash: string; winding: boolean | null } => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { hash: 'no-canvas', winding: null };
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 280, 80);
      ctx.fillStyle = '#069';
      ctx.font = '16px Arial';
      ctx.fillText('CloakBrowser diagnostics 0123456789', 8, 24);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.font = '18px "Times New Roman"';
      ctx.fillText('font/canvas surface', 8, 52);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(255,0,255)';
      ctx.beginPath();
      ctx.arc(215, 32, 26, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
      let winding: boolean | null = null;
      try {
        ctx.rect(230, 10, 30, 30);
        ctx.rect(235, 15, 20, 20);
        winding = ctx.isPointInPath(237, 17, 'evenodd') === false;
      } catch {
        winding = null;
      }
      return { hash: hashString(canvas.toDataURL()), winding };
    } catch {
      return { hash: 'canvas-error', winding: null };
    }
  };

  // --- font enumeration (width-difference probe) ---
  const fontSummary = (): { hash: string; fonts: { family: string; available: boolean }[] } => {
    const families = [
      'Arial', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Courier New',
      'Georgia', 'Helvetica', 'Menlo', 'Monaco', 'Noto Sans', 'Roboto',
      'Segoe UI', 'SF Pro Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
      'Verdana', 'DejaVu Sans', 'Liberation Sans',
    ];
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const text = 'mmmmmmmmmmlliWWWWW__0123456789';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return { hash: 'no-font-canvas', fonts: families.map((family) => ({ family, available: false })) };
    const baseWidths = new Map<string, number>();
    for (const base of baseFonts) {
      ctx.font = `72px ${base}`;
      baseWidths.set(base, ctx.measureText(text).width);
    }
    const fonts = families.map((family) => {
      const available = baseFonts.some((base) => {
        ctx.font = `72px "${family}", ${base}`;
        return Math.abs(ctx.measureText(text).width - (baseWidths.get(base) ?? 0)) > 0.01;
      });
      return { family, available };
    });
    return {
      hash: hashString(fonts.map((f) => `${f.family}:${f.available ? 1 : 0}`).join('|')),
      fonts,
    };
  };

  // --- audio (OfflineAudioContext) ---
  const audioSummary = async (): Promise<string | null> => {
    try {
      const win = window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
      const OfflineCtx = window.OfflineAudioContext ?? win.webkitOfflineAudioContext;
      if (!OfflineCtx) return null;
      const ctx = new OfflineCtx(1, 5000, 44100);
      const oscillator = ctx.createOscillator();
      const compressor = ctx.createDynamicsCompressor();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(ctx.destination);
      oscillator.start(0);
      const buffer = await ctx.startRendering();
      const data = buffer.getChannelData(0);
      let sample = '';
      for (let i = 0; i < data.length; i += 100) sample += data[i].toFixed(6);
      return hashString(sample);
    } catch {
      return null;
    }
  };

  // --- clientRects (sub-pixel layout geometry — high entropy, not yet probed) ---
  const clientRectsSummary = (): string => {
    try {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
      const samples = [
        '<span style="font:15px Arial">Cwm fjord bank glyphs vext quiz</span>',
        '<span style="font:italic 22px \'Times New Roman\'">flïp—éàüñ</span>',
        '<span style="font:700 11px \'Segoe UI\'">WWWWiiiilllljjjj</span>',
        '<span style="font:31px monospace;letter-spacing:1.2px">0O1lI|€™</span>',
        '<span style="display:inline-block;transform:rotate(7deg) scale(1.3);font:18px serif">rotate✨</span>',
      ];
      host.innerHTML = samples.join('');
      document.body.appendChild(host);
      const parts: string[] = [];
      for (const el of Array.from(host.children)) {
        const r = el.getBoundingClientRect();
        parts.push([r.width, r.height, r.x, r.y].map((n) => n.toFixed(3)).join(','));
        for (const cr of Array.from(el.getClientRects())) {
          parts.push([cr.width, cr.height].map((n) => n.toFixed(3)).join(','));
        }
      }
      document.body.removeChild(host);
      return hashString(parts.join('|'));
    } catch {
      return 'no-clientrects';
    }
  };

  // --- WebGL vendor/renderer + selected getParameter values ---
  const webglSummary = () => {
    const out = {
      vendor: null as string | null,
      renderer: null as string | null,
      params: {
        maxTextureSize: null as number | null,
        maxRenderbufferSize: null as number | null,
        maxVertexAttribs: null as number | null,
        maxViewportDims: null as string | null,
        aliasedLineWidthRange: null as string | null,
        shadingLanguageVersion: null as string | null,
        glVersion: null as string | null,
      },
    };
    try {
      const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
      if (!gl) return out;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        out.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
        out.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
      }
      const num = (p: number): number | null => {
        const v = gl.getParameter(p) as number;
        return typeof v === 'number' ? v : null;
      };
      const pair = (p: number): string | null => {
        const v = gl.getParameter(p) as ArrayLike<number> | null;
        return v && v.length >= 2 ? `${v[0]},${v[1]}` : null;
      };
      out.params.maxTextureSize = num(gl.MAX_TEXTURE_SIZE);
      out.params.maxRenderbufferSize = num(gl.MAX_RENDERBUFFER_SIZE);
      out.params.maxVertexAttribs = num(gl.MAX_VERTEX_ATTRIBS);
      out.params.maxViewportDims = pair(gl.MAX_VIEWPORT_DIMS);
      out.params.aliasedLineWidthRange = pair(gl.ALIASED_LINE_WIDTH_RANGE);
      out.params.shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string;
      out.params.glVersion = gl.getParameter(gl.VERSION) as string;
    } catch {
      /* leave nulls */
    }
    return out;
  };

  // --- UA-Client-Hints high-entropy values ---
  type UaDataLike = {
    mobile?: boolean;
    brands?: { brand: string; version: string }[];
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
  };
  const uaCHSummary = async (): Promise<RawObservation['uaClientHints']> => {
    const uaData = (navigator as Navigator & { userAgentData?: UaDataLike }).userAgentData;
    if (!uaData || !uaData.getHighEntropyValues) return null;
    try {
      const h = await uaData.getHighEntropyValues([
        'platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion', 'fullVersionList',
      ]);
      const list = Array.isArray(h.fullVersionList) ? (h.fullVersionList as { brand: string; version: string }[]) : [];
      return {
        platform: (h.platform as string) ?? null,
        platformVersion: (h.platformVersion as string) ?? null,
        architecture: (h.architecture as string) ?? null,
        bitness: (h.bitness as string) ?? null,
        model: (h.model as string) ?? null,
        uaFullVersion: (h.uaFullVersion as string) ?? null,
        mobile: typeof uaData.mobile === 'boolean' ? uaData.mobile : null,
        brands: (uaData.brands ?? []).map((b) => ({ brand: b.brand, version: b.version })),
        fullVersionList: list.map((b) => ({ brand: b.brand, version: b.version })),
      };
    } catch {
      return null;
    }
  };

  const canvas = canvasSummary();
  const fonts = fontSummary();
  const webgl = webglSummary();
  const audioHash = await audioSummary();
  const uaClientHints = await uaCHSummary();
  const nav = navigator as Navigator & { deviceMemory?: number };

  return {
    userAgent: navigator.userAgent,
    uaClientHints,
    platform: navigator.platform,
    languages: [...navigator.languages],
    webdriver: navigator.webdriver,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? null,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    webglParams: webgl.params,
    canvasHash: canvas.hash,
    canvasWinding: canvas.winding,
    audioHash,
    fontHash: fonts.hash,
    fonts: fonts.fonts,
    clientRectsHash: clientRectsSummary(),
  };
}

/**
 * tsx/esbuild compiles named in-page helpers with a `__name(fn, "name")` wrapper
 * (keepNames). When Playwright serializes the probe function and runs it in the
 * browser, `__name` is undefined there and throws. Define an identity shim first.
 * A plain string is evaluated verbatim (not transpiled), so it never references
 * `__name` itself.
 */
export async function defineNameShim(page: Page): Promise<void> {
  await page.evaluate('globalThis.__name || (globalThis.__name = function (f) { return f; }); true');
}

/** Run the probe on an open page and pair it with profile metadata. */
export async function captureObservation(page: Page, meta: ProfileMeta): Promise<ProfileObservation> {
  await defineNameShim(page);
  const raw = (await page.evaluate(probeInPage)) as RawObservation;
  return {
    ...raw,
    profileId: meta.profileId,
    profileName: meta.profileName,
    seed: meta.seed,
    ok: true,
    capturedAt: new Date().toISOString(),
  };
}
