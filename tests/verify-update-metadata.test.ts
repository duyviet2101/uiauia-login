import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { metadataAssetNames, verifyUpdateMetadata } from '../scripts/verify-update-metadata.mjs';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'update-metadata-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('metadataAssetNames', () => {
  it('reads both file URLs and the primary path without duplicates', () => {
    const names = metadataAssetNames([
      'files:',
      '  - url: CloakBrowser-Manager-0.2.6-x64.dmg',
      '  - url: "CloakBrowser-Manager-0.2.6-arm64.dmg"',
      'path: CloakBrowser-Manager-0.2.6-x64.dmg',
    ].join('\n'));

    expect(names).toEqual([
      'CloakBrowser-Manager-0.2.6-x64.dmg',
      'CloakBrowser-Manager-0.2.6-arm64.dmg',
    ]);
  });
});

describe('verifyUpdateMetadata', () => {
  it('accepts metadata when every referenced asset exists', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'latest.yml'), 'path: CloakBrowser-Manager-Setup-0.2.6.exe\n');
    writeFileSync(join(dir, 'CloakBrowser-Manager-Setup-0.2.6.exe'), 'installer');

    expect(verifyUpdateMetadata(dir)).toEqual(['latest.yml']);
  });

  it('rejects metadata that points at a differently named asset', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'latest.yml'), 'path: CloakBrowser-Manager-Setup-0.2.6.exe\n');
    writeFileSync(join(dir, 'CloakBrowser.Manager.Setup.0.2.6.exe'), 'installer');

    expect(() => verifyUpdateMetadata(dir)).toThrow(
      'latest.yml references missing asset: CloakBrowser-Manager-Setup-0.2.6.exe',
    );
  });
});
