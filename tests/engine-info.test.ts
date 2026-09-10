import { describe, it, expect } from 'vitest';
import { describeEngine, chromiumPartOf, parseReportedVersion } from '../src/main/engine-info';

const raw = {
  version: '145.0.7632.109.2',
  bundledVersion: '146.0.7680.177.5',
  tier: 'free',
  platform: 'darwin-arm64',
  binaryPath: '/Users/x/.cloakbrowser/chromium-145.0.7632.109.2/Chromium.app/Contents/MacOS/Chromium',
  installed: true,
};

describe('chromiumPartOf', () => {
  it('drops the CloakBrowser patch revision', () => {
    // A marker is a Chromium version plus CloakBrowser's own revision. The
    // binary only ever reports the Chromium part, so that is all that can be
    // compared — comparing the whole string would flag every build as a mismatch.
    expect(chromiumPartOf('145.0.7632.109.2')).toBe('145.0.7632.109');
    expect(chromiumPartOf('146.0.7680.177.5')).toBe('146.0.7680.177');
  });

  it('leaves a bare four-component version alone', () => {
    expect(chromiumPartOf('145.0.7632.109')).toBe('145.0.7632.109');
  });
});

describe('parseReportedVersion', () => {
  it('extracts the version from Chromium --version output', () => {
    expect(parseReportedVersion('Chromium 145.0.7632.109 \n')).toBe('145.0.7632.109');
  });
  it('returns null when there is no version to read', () => {
    expect(parseReportedVersion('command not found')).toBeNull();
  });
});

describe('describeEngine', () => {
  it('reports no problem when the binary agrees with the marker', () => {
    const info = describeEngine(raw, '145.0.7632.109');
    expect(info.problems).toEqual([]);
    expect(info.markerVersion).toBe('145.0.7632.109.2');
    expect(info.binaryVersion).toBe('145.0.7632.109');
  });

  it('keeps bundledVersion separate from the version in use', () => {
    // On darwin `bundledVersion` names a build that has no macOS asset at all.
    // Showing it as the engine in use would drift every locked identity against
    // a version that never ran here.
    const info = describeEngine(raw, '145.0.7632.109');
    expect(info.bundledVersion).toBe('146.0.7680.177.5');
    expect(info.markerVersion).not.toBe(info.bundledVersion);
  });

  it('flags a binary that is not the version the package claims', () => {
    // The case this exists for: CLOAKBROWSER_BINARY_PATH points somewhere else,
    // and the identity lock keeps recording the package's number regardless.
    const info = describeEngine(raw, '151.0.7922.108');
    expect(info.problems.map((p) => p.kind)).toEqual(['version-mismatch']);
    expect(info.problems[0].message).toContain('151.0.7922.108');
    expect(info.problems[0].message).toContain('145.0.7632.109');
  });

  it('flags a binary that will not answer, instead of assuming it matches', () => {
    const info = describeEngine(raw, null);
    expect(info.problems.map((p) => p.kind)).toEqual(['unreadable']);
  });

  it('flags a missing binary and does not also claim a version mismatch', () => {
    const info = describeEngine({ ...raw, installed: false }, null);
    expect(info.problems.map((p) => p.kind)).toEqual(['not-installed']);
    expect(info.problems[0].message).toMatch(/không tự tải/i);
  });

  it('flags a pin that was asked for but not honoured', () => {
    const info = describeEngine(raw, '145.0.7632.109', '151.0.7922.108.4');
    expect(info.problems.map((p) => p.kind)).toEqual(['pin-unsatisfied']);
    expect(info.requestedVersion).toBe('151.0.7922.108.4');
  });

  it('is satisfied by a pin that matches the marker exactly', () => {
    const info = describeEngine(raw, '145.0.7632.109', '145.0.7632.109.2');
    expect(info.problems).toEqual([]);
  });
});
