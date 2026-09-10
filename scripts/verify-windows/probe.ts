import type { Page } from 'playwright-core';
import type { ProfileObservation, RawObservation } from './types';
import type { FontMetricSpec, Persona } from './persona';
import { fontDictionary, fontMetricSpecs } from './persona';

/** Metadata the orchestrator pairs with the in-page measurement. */
export interface ProfileMeta {
  profileId: string;
  profileName: string;
  seed: number;
  persona: Persona;
  launchMode: 'app' | 'minimal';
  openIndex: number;
  measureIndex: number;
  group?: string;
  browserVersion?: string;
  packageVersion?: string;
  launchArgs?: string[];
}

export interface ProbeConfig {
  fontFamilies: string[];
  fontMetrics: FontMetricSpec[];
  webrtcTimeoutMs: number;
}

/**
 * The in-page probe. Serialized and run inside the profile's browser window, so
 * it must be fully self-contained (no closure over module scope).
 *
 * Every fragile measurement is wrapped in a Measured envelope so `unsupported`
 * (API absent) never looks like `error` (measurement failed) and neither ever
 * looks like a shared value in collision analysis.
 *
 * Digests are SHA-256 (crypto.subtle on the loopback secure context). The old
 * 32-bit FNV-1a was too small to support a claim that two outputs are identical.
 */
async function probeInPage(config: ProbeConfig): Promise<RawObservation> {
  type Measured<T> =
    | { status: 'ok'; value: T }
    | { status: 'unsupported'; reason: string }
    | { status: 'error'; reason: string };

  const ok = <T,>(value: T): Measured<T> => ({ status: 'ok', value });
  const unsupported = <T,>(reason: string): Measured<T> => ({ status: 'unsupported', reason });
  const failed = <T,>(reason: string): Measured<T> => ({ status: 'error', reason });
  const reasonOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

  const toHex = (buf: ArrayBuffer): string =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const sha256 = async (input: string | Uint8Array): Promise<string> => {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return toHex(digest);
  };

  // --- canvas: two independent workloads ------------------------------------
  const drawText = (ctx: CanvasRenderingContext2D): void => {
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
  };

  // Pure geometry — no glyph rasterisation. If `text` differs between two
  // profiles but `geometry` does not, the difference came from font rendering.
  const drawGeometry = (ctx: CanvasRenderingContext2D): void => {
    ctx.fillStyle = '#102030';
    ctx.fillRect(0, 0, 280, 80);
    const gradient = ctx.createLinearGradient(0, 0, 280, 80);
    gradient.addColorStop(0, 'rgba(255,0,0,0.8)');
    gradient.addColorStop(0.5, 'rgba(0,255,128,0.5)');
    gradient.addColorStop(1, 'rgba(0,64,255,0.9)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(10, 70);
    ctx.bezierCurveTo(60, 5, 140, 95, 270, 20);
    ctx.lineTo(270, 75);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.7;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(40 + i * 38, 40, 9 + i * 1.3, 0, Math.PI * 1.5, false);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = 'rgb(64,192,255)';
    ctx.fillRect(120, 18, 90, 44);
  };

  const canvasWorkload = async (
    workload: string,
    draw: (ctx: CanvasRenderingContext2D) => void,
    withWinding: boolean,
  ): Promise<Measured<unknown>> => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (!ctx) return unsupported('2d context unavailable');
      draw(ctx);

      let winding: boolean | null = null;
      if (withWinding) {
        try {
          ctx.rect(230, 10, 30, 30);
          ctx.rect(235, 15, 20, 20);
          winding = ctx.isPointInPath(237, 17, 'evenodd') === false;
        } catch {
          winding = null;
        }
      }

      const dataUrl = canvas.toDataURL();
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const bytes = new Uint8Array(image.data.buffer.slice(0));
      let pixelSum = 0;
      for (let i = 0; i < bytes.length; i++) pixelSum += bytes[i];
      const pixelSamples: number[] = [];
      for (let i = 0; i < 12; i++) pixelSamples.push(bytes[Math.floor((bytes.length / 12) * i)]);

      return ok({
        workload,
        digest: await sha256(dataUrl),
        dataUrlLength: dataUrl.length,
        pixelDigest: await sha256(bytes),
        pixelSamples,
        pixelSum,
        winding,
      });
    } catch (e) {
      return failed(reasonOf(e));
    }
  };

  // --- audio ----------------------------------------------------------------
  const audioSummary = async (): Promise<Measured<unknown>> => {
    const win = window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
    const OfflineCtx = window.OfflineAudioContext ?? win.webkitOfflineAudioContext;
    if (!OfflineCtx) return unsupported('OfflineAudioContext absent');
    try {
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

      const rendering = ctx.startRendering();
      const buffer = await Promise.race([
        rendering,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (!buffer) return failed('rendering timed out after 8000ms');

      const data = buffer.getChannelData(0);
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let nonZeroCount = 0;
      let sample = '';
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        if (v !== 0) nonZeroCount++;
        if (i % 100 === 0) sample += v.toFixed(6);
      }
      return ok({
        digest: await sha256(sample),
        sampleCount: data.length,
        nonZeroCount,
        min,
        max,
        mean: sum / data.length,
        head: Array.from(data.slice(0, 8)),
      });
    } catch (e) {
      return failed(reasonOf(e));
    }
  };

  // --- fonts: availability (one bit per family) ------------------------------
  const fontAvailability = async (families: string[]): Promise<Measured<unknown>> => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return unsupported('2d context unavailable');
      const baseFonts = ['monospace', 'sans-serif', 'serif'];
      const text = 'mmmmmmmmmmlliWWWWW__0123456789';
      const baseWidths = new Map<string, number>();
      for (const base of baseFonts) {
        ctx.font = `72px ${base}`;
        baseWidths.set(base, ctx.measureText(text).width);
      }
      const list = families.map((family) => {
        const available = baseFonts.some((base) => {
          ctx.font = `72px "${family}", ${base}`;
          return Math.abs(ctx.measureText(text).width - (baseWidths.get(base) ?? 0)) > 0.01;
        });
        return { family, available };
      });
      return ok({
        digest: await sha256(list.map((f) => `${f.family}:${f.available ? 1 : 0}`).join('|')),
        families: list,
        availableCount: list.filter((f) => f.available).length,
        totalCount: list.length,
      });
    } catch (e) {
      return failed(reasonOf(e));
    }
  };

  // --- fonts: real text metrics (what a serious fingerprinter reads) ---------
  const fontMetrics = async (specs: FontMetricSpec[]): Promise<Measured<unknown>> => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return unsupported('2d context unavailable');
      const generic = /^(monospace|sans-serif|serif|cursive|fantasy)$/;
      const metrics = specs.map((spec) => {
        const quoted = generic.test(spec.family) ? spec.family : `"${spec.family}"`;
        ctx.font = `${spec.size}px ${quoted}`;
        const m = ctx.measureText(spec.text);
        return {
          key: `${spec.family}|${spec.size}|${spec.text.slice(0, 12)}`,
          width: m.width,
          ascent: typeof m.actualBoundingBoxAscent === 'number' ? m.actualBoundingBoxAscent : null,
          descent: typeof m.actualBoundingBoxDescent === 'number' ? m.actualBoundingBoxDescent : null,
        };
      });
      return ok({
        digest: await sha256(metrics.map((m) => `${m.key}=${m.width}:${m.ascent}:${m.descent}`).join('|')),
        metrics,
      });
    } catch (e) {
      return failed(reasonOf(e));
    }
  };

  // --- clientRects: raw geometry, no over-rounding --------------------------
  const clientRects = async (): Promise<Measured<unknown>> => {
    try {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
      const samples = [
        '<span style="font:15px Arial">Cwm fjord bank glyphs vext quiz</span>',
        '<span style="font:italic 22px \'Times New Roman\'">flip-eaun</span>',
        '<span style="font:700 11px \'Segoe UI\'">WWWWiiiilllljjjj</span>',
        '<span style="font:31px monospace;letter-spacing:1.2px">0O1lI|</span>',
        '<span style="display:inline-block;transform:rotate(7deg) scale(1.3);font:18px serif">rotate</span>',
      ];
      host.innerHTML = samples.join('');
      document.body.appendChild(host);
      const rects: { key: string; values: number[] }[] = [];
      let index = 0;
      for (const el of Array.from(host.children)) {
        const r = el.getBoundingClientRect();
        // Full precision - rounding here is what made small per-profile
        // differences vanish in the old harness.
        rects.push({ key: `bounding-${index}`, values: [r.width, r.height, r.x, r.y] });
        let sub = 0;
        for (const cr of Array.from(el.getClientRects())) {
          rects.push({ key: `client-${index}-${sub}`, values: [cr.width, cr.height, cr.x, cr.y] });
          sub++;
        }
        index++;
      }
      document.body.removeChild(host);
      return ok({
        digest: await sha256(rects.map((r) => `${r.key}=${r.values.join(',')}`).join('|')),
        rects,
      });
    } catch (e) {
      return failed(reasonOf(e));
    }
  };

  // --- WebRTC ICE candidates ------------------------------------------------
  // No ICE servers: gathering stays entirely local, so this works offline and
  // measures exactly what a page learns about the host without any STUN.
  const webrtc = async (timeoutMs: number): Promise<Measured<unknown>> => {
    const RTC = (window as typeof window & { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
    if (!RTC) return unsupported('RTCPeerConnection absent');
    let pc: RTCPeerConnection | null = null;
    try {
      pc = new RTC({ iceServers: [] });
      const lines: string[] = [];
      let complete = false;
      const peer = pc;
      const gathered = new Promise<void>((resolve) => {
        const done = (): void => { complete = true; resolve(); };
        peer.onicecandidate = (event): void => {
          if (event.candidate && event.candidate.candidate) lines.push(event.candidate.candidate);
          else done();
        };
        peer.onicegatheringstatechange = (): void => {
          if (peer.iceGatheringState === 'complete') done();
        };
      });
      peer.createDataChannel('probe');
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await Promise.race([gathered, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);

      // Also mine the SDP: some candidates only ever appear there.
      const sdp = peer.localDescription?.sdp ?? '';
      for (const line of sdp.split(/\r?\n/)) {
        if (line.startsWith('a=candidate:')) lines.push(line.slice('a='.length));
      }

      const isPrivate = (ip: string): boolean =>
        /^10\./.test(ip) || /^192\.168\./.test(ip) || /^127\./.test(ip) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^169\.254\./.test(ip) ||
        /^(fe80|fc|fd|::1)/i.test(ip);

      const mask = (address: string, mdns: boolean): string => {
        if (mdns) return '<uuid>.local';
        if (address.includes(':')) return `${address.split(':').slice(0, 2).join(':')}:...`;
        const parts = address.split('.');
        return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'x.x.x.x';
      };

      const seen = new Set<string>();
      const candidates: unknown[] = [];
      for (const raw of lines) {
        // candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
        const parts = raw.replace(/^candidate:/, '').split(/\s+/);
        if (parts.length < 8) continue;
        const protocol = parts[2];
        const address = parts[4];
        const typIndex = parts.indexOf('typ');
        const type = typIndex >= 0 ? parts[typIndex + 1] : 'unknown';
        const key = `${type}|${protocol}|${address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mdns = /\.local$/i.test(address);
        candidates.push({
          type,
          protocol,
          address: mask(address, mdns),
          addressDigest: await sha256(address),
          mdns,
          publicIp: !mdns && !isPrivate(address),
        });
      }

      return ok({
        candidates,
        complete,
        addresses: [...new Set(candidates.map((c) => (c as { address: string }).address))],
      });
    } catch (e) {
      return failed(reasonOf(e));
    } finally {
      try { pc?.close(); } catch { /* ignore */ }
    }
  };

  // --- WebGL ----------------------------------------------------------------
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
      extensions: [] as string[],
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
      // The extension list is the tell for the REAL backend: an ANGLE/D3D11
      // renderer string on a Metal host still exposes Metal's extension set.
      out.extensions = (gl.getSupportedExtensions() ?? []).slice().sort();
    } catch {
      /* leave nulls */
    }
    return out;
  };

  // --- UA-Client-Hints ------------------------------------------------------
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

  const canvasText = await canvasWorkload('text', drawText, true);
  const canvasGeometry = await canvasWorkload('geometry', drawGeometry, false);
  const audio = await audioSummary();
  const availability = await fontAvailability(config.fontFamilies);
  const metrics = await fontMetrics(config.fontMetrics);
  const rects = await clientRects();
  const ice = await webrtc(config.webrtcTimeoutMs);
  const webgl = webglSummary();
  const uaClientHints = await uaCHSummary();
  const nav = navigator as Navigator & { deviceMemory?: number };

  // Legacy flat fields keep the existing collision/report code working; they are
  // now SHA-256 prefixes rather than 32-bit FNV.
  const digestOf = (m: Measured<unknown>): string =>
    m.status === 'ok' ? String((m.value as { digest: string }).digest).slice(0, 16) : '';

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
    webglExtensions: webgl.extensions,
    canvasHash: digestOf(canvasText),
    canvasWinding: canvasText.status === 'ok' ? (canvasText.value as { winding: boolean | null }).winding : null,
    audioHash: audio.status === 'ok' ? digestOf(audio) : null,
    fontHash: digestOf(availability),
    fonts:
      availability.status === 'ok'
        ? (availability.value as { families: { family: string; available: boolean }[] }).families
        : [],
    clientRectsHash: digestOf(rects),
    measurements: {
      canvasText,
      canvasGeometry,
      audio,
      fontAvailability: availability,
      fontMetrics: metrics,
      clientRects: rects,
      webrtc: ice,
    },
  } as unknown as RawObservation;
}

/**
 * tsx/esbuild compiles named in-page helpers with a `__name(fn, "name")` wrapper
 * (keepNames). When Playwright serializes the probe function and runs it in the
 * browser, `__name` is undefined there and throws. Define an identity shim first.
 */
export async function defineNameShim(page: Page): Promise<void> {
  await page.evaluate('globalThis.__name || (globalThis.__name = function (f) { return f; }); true');
}

export function probeConfigFor(persona: Persona): ProbeConfig {
  return {
    fontFamilies: fontDictionary(persona),
    fontMetrics: fontMetricSpecs(persona),
    webrtcTimeoutMs: 4000,
  };
}

/** Run the probe on an open page and pair it with profile metadata. */
export async function captureObservation(page: Page, meta: ProfileMeta): Promise<ProfileObservation> {
  await defineNameShim(page);
  const raw = (await page.evaluate(probeInPage, probeConfigFor(meta.persona))) as RawObservation;
  return {
    ...raw,
    profileId: meta.profileId,
    profileName: meta.profileName,
    seed: meta.seed,
    persona: meta.persona,
    launchMode: meta.launchMode,
    openIndex: meta.openIndex,
    measureIndex: meta.measureIndex,
    group: meta.group,
    browserVersion: meta.browserVersion,
    packageVersion: meta.packageVersion,
    launchArgs: meta.launchArgs,
    ok: true,
    capturedAt: new Date().toISOString(),
  };
}
