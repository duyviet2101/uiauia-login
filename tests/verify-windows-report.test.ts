import { describe, it, expect } from 'vitest';
import { buildReport, renderMarkdown, type RunMeta } from '../scripts/verify-windows/report';
import type { ProfileObservation } from '../scripts/verify-windows/types';
import { errorObservation } from '../scripts/verify-windows/types';

const META: RunMeta = {
  startedAt: '2026-06-24T00:00:00.000Z',
  cloakBrowserVersion: '146.0.0.0',
  hostOS: 'win32 10.0.19044 (x64)',
  profileCount: 2,
  screen: '2560x1440',
  withProxies: false,
  fontsDir: null,
  external: true,
};

function obs(id: string, over: Partial<ProfileObservation> = {}): ProfileObservation {
  return {
    profileId: id, profileName: id, seed: 1, ok: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/146.0.0.0 Safari/537.36',
    uaClientHints: {
      platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86', bitness: '64',
      model: '', uaFullVersion: '146.0.7680.177', mobile: false,
      brands: [{ brand: 'Chromium', version: '146' }],
      fullVersionList: [{ brand: 'Chromium', version: '146.0.7680.177' }],
    },
    platform: 'Win32', languages: ['en-US'], webdriver: false, maxTouchPoints: 0,
    hardwareConcurrency: 8, deviceMemory: 8,
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1392, colorDepth: 24, pixelDepth: 24 },
    innerWidth: 2560, innerHeight: 1300, devicePixelRatio: 1,
    timezone: 'America/New_York', timezoneOffset: 240,
    webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: `ANGLE (NVIDIA, GPU-${id}, D3D11)`,
    webglParams: {
      maxTextureSize: 16384, maxRenderbufferSize: 16384, maxVertexAttribs: 16,
      maxViewportDims: '32767,32767', aliasedLineWidthRange: '1,1',
      shadingLanguageVersion: 'WebGL GLSL ES 1.0', glVersion: 'WebGL 1.0',
    },
    canvasHash: `canvas-${id}`, canvasWinding: false, audioHash: `audio-${id}`,
    fontHash: `font-${id}`, fonts: [{ family: 'Arial', available: true }],
    clientRectsHash: `rects-${id}`,
    capturedAt: '2026-06-24T12:00:00.000Z',
    ...over,
  };
}

const creepjs = (fp: string | null): ProfileObservation['external'] => [
  { site: 'creepjs', url: 'x', status: 'ok', headline: { fingerprint: fp } },
];

describe('buildReport verdict', () => {
  it('PASS when no HIGH collisions, all consistent, none failed', () => {
    const report = buildReport(META, [obs('p1'), obs('p2')]);
    expect(report.verdict).toMatch(/^PASS/);
  });

  it('ATTENTION and names the vector on a HIGH collision', () => {
    const report = buildReport(META, [obs('p1', { fontHash: 'X' }), obs('p2', { fontHash: 'X' })]);
    expect(report.verdict).toMatch(/^ATTENTION/);
    expect(report.verdict).toContain('fontHash');
  });

  it('ATTENTION on a consistency failure (SwiftShader renderer)', () => {
    const report = buildReport(META, [obs('p1', { webglRenderer: 'Google SwiftShader' }), obs('p2')]);
    expect(report.verdict).toMatch(/^ATTENTION/);
    expect(report.verdict).toContain('consistency');
  });

  it('counts failed-to-launch profiles in the verdict', () => {
    const report = buildReport(META, [obs('p1'), errorObservation('p2', 'p2', 2, 'boom')]);
    expect(report.verdict).toContain('failed to launch');
  });
});

describe('renderMarkdown external summary', () => {
  it('reports distinct creepjs fingerprints', () => {
    const md = renderMarkdown(buildReport(META, [
      obs('p1', { external: creepjs('a'.repeat(64)) }),
      obs('p2', { external: creepjs('b'.repeat(64)) }),
    ]));
    expect(md).toContain('distinct');
  });

  it('flags colliding creepjs fingerprints as a linkage', () => {
    const md = renderMarkdown(buildReport(META, [
      obs('p1', { external: creepjs('c'.repeat(64)) }),
      obs('p2', { external: creepjs('c'.repeat(64)) }),
    ]));
    expect(md).toContain('collide');
  });
});
