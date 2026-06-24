// Phase 0 artifact generator for the fonts-harden work. Launches ONE throwaway
// windows-spoof profile via the real launch path and runs the dictionary font
// width-probe (the same captureFingerprintDiagnostics the app uses), then writes
// scripts/verify-windows/windows-font-baseline.json with provenance + a live
// validation (what the probe detects on THIS box, and which fonts it flags as
// non-stock). Run: tsx scripts/verify-windows/capture-font-baseline.ts
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir, release, arch } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { launchPersistentContext, binaryInfo, ensureBinary } from 'cloakbrowser';
import { ProfileStore } from '../../src/main/store';
import { buildLaunchArgs } from '../../src/main/launch-args';
import { prepareBrowserPreferences } from '../../src/main/browser-preferences';
import { captureFingerprintDiagnostics } from '../../src/main/fingerprint-probe';
import { WINDOWS_FONT_BASELINE, NON_STOCK_FONTS, FONT_DICTIONARY } from '../../src/main/font-baseline';
import { defineNameShim } from './probe';
import { startProbeServer } from './serve';

async function main(): Promise<void> {
  await ensureBinary();
  const version = binaryInfo().version;
  const dataDir = mkdtempSync(join(tmpdir(), 'font-baseline-'));
  const store = new ProfileStore(dataDir);
  await store.init();
  const probeServer = await startProbeServer();

  try {
    const profile = await store.create({ name: 'baseline', platform: 'windows' });
    prepareBrowserPreferences(profile.userDataDir, { blockGeolocation: profile.blockGeolocation, doNotTrack: profile.doNotTrack });
    const ctx = await launchPersistentContext(buildLaunchArgs(profile, { width: 2560, height: 1440 }));
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(probeServer.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await defineNameShim(page);
      const diag = await captureFingerprintDiagnostics(page);
      const detected = diag.fonts.filter((f) => f.available).map((f) => f.family);

      const out = {
        provenance: `Captured ${new Date().toISOString()} on ${process.platform} ${release()} (${arch()}), CloakBrowser ${version}, via the measureText width-probe over FONT_DICTIONARY. Baseline families derived from the HKLM font registry of this clean Windows 10 Enterprise LTSC 2021 box; the runtime source of truth is src/main/font-baseline.ts.`,
        cloakBrowserVersion: version,
        baselineFamilies: WINDOWS_FONT_BASELINE,
        nonStockProbed: NON_STOCK_FONTS,
        dictionary: FONT_DICTIONARY,
        validationOnThisBox: {
          detectedCount: detected.length,
          detectedFonts: detected,
          nonStandardFonts: diag.nonStandardFonts,
        },
      };
      const here = dirname(fileURLToPath(import.meta.url));
      const file = join(here, 'windows-font-baseline.json');
      writeFileSync(file, JSON.stringify(out, null, 2));

      console.log(`baseline families: ${WINDOWS_FONT_BASELINE.length}`);
      console.log(`dictionary size: ${FONT_DICTIONARY.length}`);
      console.log(`detected on this box: ${detected.length} families`);
      console.log(`NON-STANDARD (flagged): ${diag.nonStandardFonts.length ? diag.nonStandardFonts.join(', ') : '(none — clean box)'}`);
      console.log(`written: ${file}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  } finally {
    await probeServer.close().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('capture-font-baseline failed:', error);
  process.exit(1);
});
