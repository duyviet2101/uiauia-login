import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * A windows-spoof profile looks suspicious if we sandbox font enumeration down
 * to a handful of files (a thin, obviously-fake list is worse than the OS
 * default). Require a reasonably complete bundle before turning fonts-dir on —
 * a standard C:\Windows\Fonts holds 200+ files.
 */
const MIN_FONT_FILES = 50;
const FONT_FILE = /\.(ttf|ttc|otf)$/i;

/** Prod: bundled via electron-builder extraResources; dev: build/ working copy. */
function defaultCandidates(): string[] {
  return [
    process.resourcesPath ? join(process.resourcesPath, 'fonts', 'windows') : null,
    join(process.cwd(), 'build', 'fonts', 'windows'),
  ].filter((x): x is string => !!x);
}

/**
 * Resolve the bundled Windows font directory passed to --fingerprint-fonts-dir.
 * Returns the first candidate that exists and holds at least MIN_FONT_FILES font
 * files; otherwise null, so a missing or partial bundle leaves enumeration at the
 * OS default rather than faking a sparse, easily-detected font list.
 */
export function resolveWindowsFontsDir(candidates: string[] = defaultCandidates()): string | null {
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) continue;
      const fontCount = readdirSync(dir).filter((f) => FONT_FILE.test(f)).length;
      if (fontCount >= MIN_FONT_FILES) return dir;
    } catch { /* ignore unreadable candidate */ }
  }
  return null;
}
