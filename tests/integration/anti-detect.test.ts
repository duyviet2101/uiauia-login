import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchPersistentContext } from 'cloakbrowser';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TIMEOUT = 90_000;

interface FP {
  webglRenderer: string | null;
  visitorId: string;
  webdriver: boolean;
}

// Mirror the production launch args (see src/main/launch-args.ts).
async function launchAndProbe(seed: number, dataDir: string): Promise<FP> {
  const ctx = await launchPersistentContext({
    userDataDir: dataDir,
    headless: false,
    stealthArgs: false,
    args: [`--fingerprint=${seed}`, '--fingerprint-platform=windows', '--ignore-gpu-blocklist'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://example.com');
  const fp = await page.evaluate(async (): Promise<FP> => {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const webglRenderer = gl && dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : null;
    // @ts-expect-error - remote ESM module loaded in the browser, no local types
    const lib = await import('https://openfpcdn.io/fingerprintjs/v4');
    const agent = await lib.load();
    const { visitorId } = await agent.get();
    return { webglRenderer, visitorId, webdriver: navigator.webdriver };
  });
  await ctx.close();
  return fp;
}

describe('anti-detect: two profiles look like distinct devices', () => {
  let dir1: string;
  let dir2: string;
  let fp1: FP;
  let fp2: FP;

  beforeAll(async () => {
    dir1 = mkdtempSync(join(tmpdir(), 'cloak-test-1-'));
    dir2 = mkdtempSync(join(tmpdir(), 'cloak-test-2-'));
    [fp1, fp2] = await Promise.all([
      launchAndProbe(11111111, dir1),
      launchAndProbe(22222222, dir2),
    ]);
  }, TIMEOUT);

  afterAll(() => {
    try { rmSync(dir1, { recursive: true, force: true }); } catch { /* */ }
    try { rmSync(dir2, { recursive: true, force: true }); } catch { /* */ }
  });

  it('both profiles hide webdriver', () => {
    expect(fp1.webdriver).toBe(false);
    expect(fp2.webdriver).toBe(false);
  });

  it('profiles produce different WebGL renderers (seed-driven GPU)', () => {
    expect(fp1.webglRenderer).not.toBe(fp2.webglRenderer);
  });

  it('FingerprintJS computes different visitor IDs (seen as different devices)', () => {
    expect(fp1.visitorId).not.toBe(fp2.visitorId);
  });
});
