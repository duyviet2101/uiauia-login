import type { Page } from 'playwright-core';
import type { Fingerprint, FingerprintDiagnostics } from './types';
import { FONT_DICTIONARY, WINDOWS_FONT_BASELINE } from './font-baseline';
import { findNonStandardFonts } from './host-fonts';

export interface RawProbe {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  languages: string[];
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  devicePixelRatio: number;
  webglVendor: string | null;
  webglRenderer: string | null;
  timezone: string;
  webdriver: boolean;
}

export interface RawDiagnostics {
  canvasHash: string;
  canvasWinding: boolean | null;
  audioHash: string | null;
  fontHash: string;
  fonts: { family: string; available: boolean }[];
}

export function parseFingerprint(raw: RawProbe): Fingerprint {
  return {
    userAgent: raw.userAgent,
    platform: raw.platform,
    hardwareConcurrency: raw.hardwareConcurrency,
    deviceMemory: raw.deviceMemory ?? null,
    languages: raw.languages,
    screen: { width: raw.screenWidth, height: raw.screenHeight, colorDepth: raw.colorDepth },
    devicePixelRatio: raw.devicePixelRatio,
    webglVendor: raw.webglVendor,
    webglRenderer: raw.webglRenderer,
    timezone: raw.timezone,
    webdriver: raw.webdriver,
    capturedAt: new Date().toISOString(),
  };
}

export function parseDiagnostics(
  raw: RawDiagnostics,
  baseline: string[] = WINDOWS_FONT_BASELINE,
): FingerprintDiagnostics {
  const available = raw.fonts.filter((f) => f.available);
  // Dictionary fonts present but outside the stock Windows baseline = user-installed
  // fonts that leak identically into every profile (a real linkage signal).
  const nonStandardFonts = findNonStandardFonts(available.map((f) => f.family), baseline);
  const warnings: string[] = [];
  if (!raw.audioHash) warnings.push('Audio probe unavailable');
  if (nonStandardFonts.length > 0) {
    warnings.push(
      `${nonStandardFonts.length} user-installed font(s) leak identically into every profile ` +
        `(${nonStandardFonts.join(', ')}) — remove them from Windows, or use a clean machine for high-value accounts.`,
    );
  }
  return {
    canvasHash: raw.canvasHash,
    canvasWinding: raw.canvasWinding,
    audioHash: raw.audioHash,
    fontHash: raw.fontHash,
    fonts: raw.fonts,
    fontsAvailable: available.length,
    fontsTotal: raw.fonts.length,
    nonStandardFonts,
    warnings,
    capturedAt: new Date().toISOString(),
  };
}

function probeInPage(): RawProbe {
  let webglVendor: string | null = null;
  let webglRenderer: string | null = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) {
      webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
      webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
    }
  } catch { /* ignore */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    languages: [...navigator.languages],
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    devicePixelRatio: window.devicePixelRatio,
    webglVendor,
    webglRenderer,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webdriver: navigator.webdriver,
  };
}

function probeDiagnosticsInPage(families: string[]): Promise<RawDiagnostics> {
  const hashString = (input: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };

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

  const fontSummary = (): { hash: string; fonts: { family: string; available: boolean }[] } => {
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
        const width = ctx.measureText(text).width;
        return Math.abs(width - (baseWidths.get(base) ?? 0)) > 0.01;
      });
      return { family, available };
    });
    return {
      hash: hashString(fonts.map((f) => `${f.family}:${f.available ? 1 : 0}`).join('|')),
      fonts,
    };
  };

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

  const canvas = canvasSummary();
  const fonts = fontSummary();
  return audioSummary().then((audioHash) => ({
    canvasHash: canvas.hash,
    canvasWinding: canvas.winding,
    audioHash,
    fontHash: fonts.hash,
    fonts: fonts.fonts,
  }));
}

/**
 * Read the fingerprint from an already-open page. The probe only reads
 * navigator/screen/WebGL, which are available on any document (including the
 * default about:blank), so no extra tab is opened.
 */
export async function captureFingerprint(page: Page): Promise<Fingerprint> {
  const raw = (await page.evaluate(probeInPage)) as RawProbe;
  return parseFingerprint(raw);
}

export async function captureFingerprintDiagnostics(page: Page): Promise<FingerprintDiagnostics> {
  const raw = (await page.evaluate(probeDiagnosticsInPage, FONT_DICTIONARY)) as RawDiagnostics;
  return parseDiagnostics(raw);
}

// Loaded as a string so TypeScript doesn't try to resolve the remote module.
const VISITOR_ID_SNIPPET = `(async () => {
  try {
    const fp = await import('https://openfpcdn.io/fingerprintjs/v4');
    const agent = await fp.load();
    const r = await agent.get();
    return r.visitorId;
  } catch { return null; }
})()`;

/**
 * Compute the FingerprintJS v4 visitorId for the current page — a single
 * "device id" the way commercial fingerprinters see it. Best-effort: needs
 * network + a real (non-CSP-blocked) origin; returns null on any failure.
 */
export async function captureVisitorId(page: Page): Promise<string | null> {
  try {
    return (await page.evaluate(VISITOR_ID_SNIPPET)) as string | null;
  } catch {
    return null;
  }
}
