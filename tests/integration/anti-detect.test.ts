import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchPersistentContext } from 'cloakbrowser';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TIMEOUT = 60_000;

interface FP {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  timezone: string;
  webdriver: boolean;
}

async function launchAndProbe(seed: number, dataDir: string): Promise<FP> {
  const ctx = await launchPersistentContext({
    userDataDir: dataDir,
    headless: false,
    args: [`--fingerprint=${seed}`],
  });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const fp = await page.evaluate((): FP => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webdriver: navigator.webdriver,
  }));
  await ctx.close();
  return fp;
}

describe('anti-detect: two profiles have distinct fingerprints', () => {
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

  it('profiles have different user agents', () => {
    expect(fp1.userAgent).not.toBe(fp2.userAgent);
  });

  it('profiles differ in at least one fingerprint dimension', () => {
    const different =
      fp1.userAgent !== fp2.userAgent ||
      fp1.platform !== fp2.platform ||
      fp1.hardwareConcurrency !== fp2.hardwareConcurrency ||
      fp1.timezone !== fp2.timezone;
    expect(different).toBe(true);
  });
});
