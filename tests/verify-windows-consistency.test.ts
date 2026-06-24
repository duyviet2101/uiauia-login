import { describe, it, expect } from 'vitest';
import { consistency } from '../scripts/verify-windows/consistency';
import type { ProfileObservation, RuleStatus } from '../scripts/verify-windows/types';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

/** A coherent, real-looking Windows profile: every rule should pass. */
function clean(over: Partial<ProfileObservation> = {}): ProfileObservation {
  return {
    profileId: 'p1',
    profileName: 'p1',
    seed: 12345,
    ok: true,
    userAgent: CHROME_UA,
    uaClientHints: {
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      uaFullVersion: '146.0.7680.0',
      mobile: false,
      brands: [
        { brand: 'Not(A:Brand', version: '24' },
        { brand: 'Chromium', version: '146' },
        { brand: 'Google Chrome', version: '146' },
      ],
      fullVersionList: [
        { brand: 'Not(A:Brand', version: '24.0.0.0' },
        { brand: 'Chromium', version: '146.0.7680.0' },
        { brand: 'Google Chrome', version: '146.0.7680.0' },
      ],
    },
    platform: 'Win32',
    languages: ['en-US', 'en'],
    webdriver: false,
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24, pixelDepth: 24 },
    innerWidth: 2560,
    innerHeight: 1300,
    devicePixelRatio: 1,
    timezone: 'America/New_York',
    timezoneOffset: 240, // June (EDT, UTC-4) => +240 to match capturedAt below
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    webglParams: {
      maxTextureSize: 16384, maxRenderbufferSize: 16384, maxVertexAttribs: 16,
      maxViewportDims: '32767,32767', aliasedLineWidthRange: '1,1',
      shadingLanguageVersion: 'WebGL GLSL ES 1.0', glVersion: 'WebGL 1.0',
    },
    canvasHash: 'a1b2c3d4',
    canvasWinding: false,
    audioHash: '9f8e7d6c',
    fontHash: 'deadbeef',
    fonts: [{ family: 'Arial', available: true }],
    clientRectsHash: 'cafebabe',
    capturedAt: '2026-06-24T12:00:00.000Z',
    ...over,
  };
}

function status(results: ReturnType<typeof consistency>, rule: string): RuleStatus | undefined {
  return results.find((r) => r.rule === rule)?.status;
}

describe('consistency', () => {
  it('a clean Windows profile passes every rule', () => {
    const results = consistency(clean());
    const failures = results.filter((r) => r.status === 'fail');
    expect(failures, JSON.stringify(failures)).toHaveLength(0);
  });

  it('Windows UA with a MacIntel navigator.platform fails platform coherence', () => {
    expect(status(consistency(clean({ platform: 'MacIntel' })), 'platform-coherence')).toBe('fail');
  });

  it('UA-CH platform disagreeing with the UA fails platform coherence', () => {
    const o = clean();
    const results = consistency(clean({ uaClientHints: { ...o.uaClientHints!, platform: 'macOS' } }));
    expect(status(results, 'platform-coherence')).toBe('fail');
  });

  it('a SwiftShader renderer fails the WebGL rule', () => {
    expect(status(consistency(clean({ webglRenderer: 'Google SwiftShader' })), 'webgl-renderer')).toBe('fail');
  });

  it('an Apple renderer (Mac GPU) fails the WebGL rule', () => {
    expect(status(consistency(clean({ webglRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' })), 'webgl-renderer')).toBe('fail');
  });

  it('a blank renderer fails the WebGL rule', () => {
    expect(status(consistency(clean({ webglRenderer: null })), 'webgl-renderer')).toBe('fail');
  });

  it('screen smaller than the viewport fails screen≥viewport', () => {
    expect(status(consistency(clean({ innerWidth: 3000 })), 'screen-ge-viewport')).toBe('fail');
  });

  it('navigator.webdriver true fails', () => {
    expect(status(consistency(clean({ webdriver: true })), 'webdriver-false')).toBe('fail');
  });

  it('an error/sentinel canvas hash fails the real-canvas rule', () => {
    expect(status(consistency(clean({ canvasHash: 'canvas-error' })), 'canvas-real')).toBe('fail');
  });

  it('a null audio hash fails (a missing audio on Windows is itself a tell)', () => {
    expect(status(consistency(clean({ audioHash: null })), 'audio-present')).toBe('fail');
  });

  it('out-of-range cores fail; absent deviceMemory warns', () => {
    const results = consistency(clean({ hardwareConcurrency: 1, deviceMemory: null }));
    expect(status(results, 'cores-range')).toBe('fail');
    expect(status(results, 'device-memory')).toBe('warn');
  });

  it('an implausible deviceMemory value fails', () => {
    expect(status(consistency(clean({ deviceMemory: 16 })), 'device-memory')).toBe('fail');
  });

  it('a UA-CH brand version that disagrees with the UA Chrome major fails', () => {
    const o = clean();
    const broken = {
      ...o.uaClientHints!,
      fullVersionList: [{ brand: 'Google Chrome', version: '131.0.6778.0' }, { brand: 'Chromium', version: '131.0.6778.0' }],
      brands: [{ brand: 'Google Chrome', version: '131' }, { brand: 'Chromium', version: '131' }],
    };
    expect(status(consistency(clean({ uaClientHints: broken })), 'ua-ch-version-match')).toBe('fail');
  });

  it('missing UA-CH warns rather than fails the version-match rule', () => {
    expect(status(consistency(clean({ uaClientHints: null })), 'ua-ch-version-match')).toBe('warn');
  });

  it('a timezone offset inconsistent with the IANA zone fails', () => {
    // America/New_York in June is +240; claiming +0 is a contradiction.
    expect(status(consistency(clean({ timezoneOffset: 0 })), 'timezone-offset')).toBe('fail');
  });

  it('the deliberately-broken profile produces multiple failures', () => {
    const broken = clean({
      platform: 'MacIntel',
      webglRenderer: 'Google SwiftShader',
      webdriver: true,
      audioHash: null,
    });
    const failed = consistency(broken).filter((r) => r.status === 'fail').map((r) => r.rule);
    expect(failed).toEqual(expect.arrayContaining(['platform-coherence', 'webgl-renderer', 'webdriver-false', 'audio-present']));
  });
});
