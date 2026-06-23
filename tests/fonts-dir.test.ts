import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveWindowsFontsDir } from '../src/main/fonts-dir';

function fontDir(count: number, ext = 'ttf'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fonts-'));
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `f${i}.${ext}`), 'x');
  return dir;
}

describe('resolveWindowsFontsDir', () => {
  it('returns a dir holding a complete-enough font bundle', () => {
    const dir = fontDir(50);
    expect(resolveWindowsFontsDir([dir])).toBe(dir);
  });

  it('rejects a sparse bundle to avoid a thin, spoofed-looking font list', () => {
    const dir = fontDir(10);
    expect(resolveWindowsFontsDir([dir])).toBeNull();
  });

  it('counts .ttf/.ttc/.otf but ignores other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fonts-'));
    for (let i = 0; i < 60; i++) writeFileSync(join(dir, `notes${i}.txt`), 'x');
    expect(resolveWindowsFontsDir([dir])).toBeNull();
  });

  it('returns null when no candidate directory exists', () => {
    expect(resolveWindowsFontsDir([join(tmpdir(), 'cloak-no-fonts-here-xyz')])).toBeNull();
  });

  it('picks the first candidate that has a complete bundle', () => {
    const missing = join(tmpdir(), 'cloak-missing-fonts-xyz');
    const good = fontDir(55);
    expect(resolveWindowsFontsDir([missing, good])).toBe(good);
  });
});
