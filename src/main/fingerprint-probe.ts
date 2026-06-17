import type { Page } from 'playwright-core';
import type { Fingerprint } from './types';

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

/**
 * Read the fingerprint from an already-open page. The probe only reads
 * navigator/screen/WebGL, which are available on any document (including the
 * default about:blank), so no extra tab is opened.
 */
export async function captureFingerprint(page: Page): Promise<Fingerprint> {
  const raw = (await page.evaluate(probeInPage)) as RawProbe;
  return parseFingerprint(raw);
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
