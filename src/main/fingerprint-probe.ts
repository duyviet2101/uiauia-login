import type { BrowserContext } from 'playwright-core';
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

export async function captureFingerprint(context: BrowserContext): Promise<Fingerprint> {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    const raw = (await page.evaluate(probeInPage)) as RawProbe;
    return parseFingerprint(raw);
  } finally {
    await page.close();
  }
}
