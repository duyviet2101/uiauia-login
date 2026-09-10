import { describe, it, expect } from 'vitest';
import { profileHealth, fingerprintChanges } from '../src/main/profile-health';
import type { Fingerprint, Profile } from '../src/main/types';

const fp: Fingerprint = {
  userAgent: 'ua', platform: 'MacIntel', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en-US'], screen: { width: 1920, height: 1080, colorDepth: 24 }, devicePixelRatio: 2,
  webglVendor: 'Apple', webglRenderer: 'Apple M3 Pro', timezone: 'Asia/Ho_Chi_Minh',
  webdriver: false, capturedAt: '2026-09-01T00:00:00.000Z',
};

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'A', seed: 1, platform: 'macos', proxy: null, geoip: true,
    timezone: null, locale: null, startUrl: null, userDataDir: '/d/p1',
    baseline: null, lastObservation: null, lastObservationError: null, visitorId: null, diagnostics: null,
    identityLocked: false, resolvedIdentity: null, lastProxyCheck: null,
    blockGeolocation: true, doNotTrack: false,
    windowCustomization: { enabled: true, number: 1, color: '#2563EB' },
    createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null, ...over,
  };
}

const baseline = (f: Fingerprint = fp, engineVersion = '146') =>
  ({ fingerprint: f, acceptedAt: '2026-09-01T00:00:00.000Z', engineVersion, schemaVersion: 8, source: 'first-launch' as const });

const observation = (f: Fingerprint = fp, engineVersion = '146') =>
  ({ fingerprint: f, observedAt: '2026-09-10T00:00:00.000Z', engineVersion });

describe('fingerprintChanges', () => {
  it('ignores capturedAt — it differs on every launch by definition', () => {
    const later = { ...fp, capturedAt: '2026-12-31T00:00:00.000Z' };
    expect(fingerprintChanges(fp, later)).toEqual([]);
  });

  it('reports both sides of each changed field', () => {
    const changed = { ...fp, hardwareConcurrency: 12, timezone: 'UTC' };
    expect(fingerprintChanges(fp, changed)).toEqual([
      { field: 'hardwareConcurrency', baseline: '8', observed: '12' },
      { field: 'timezone', baseline: 'Asia/Ho_Chi_Minh', observed: 'UTC' },
    ]);
  });
});

describe('profileHealth', () => {
  it('a never-opened profile is insufficient, not failed', () => {
    const h = profileHealth(profile());
    expect(h.state).toBe('insufficient');
    expect(h.changes).toEqual([]);
  });

  it('an old profile with no baseline is insufficient, not failed', () => {
    // Nothing is wrong with a profile that predates baselines.
    const h = profileHealth(profile({ lastOpenedAt: '2026-05-01T00:00:00.000Z' }));
    expect(h.state).toBe('insufficient');
  });

  it('is check-failed only when a failure was actually RECORDED', () => {
    const h = profileHealth(profile({
      baseline: baseline(),
      lastObservation: null,
      lastObservationError: { at: '2026-09-10T00:00:00.000Z', message: 'probe blew up' },
      lastOpenedAt: '2026-09-10T00:00:00.000Z',
    }));
    // A measurement that did not happen is not evidence that nothing changed.
    expect(h.state).toBe('check-failed');
    expect(h.reason).toContain('probe blew up');
  });

  // The bug this test exists for: a profile migrated from an old store has a
  // baseline, no observation, and a lastOpenedAt — and NOTHING failed. Inferring
  // a failure from the missing observation reported a broken profile to a user
  // whose profile was fine.
  it('a migrated profile with no observation is insufficient, not check-failed', () => {
    const h = profileHealth(profile({
      baseline: { ...baseline(), schemaVersion: 2, engineVersion: 'unknown' },
      lastObservation: null,
      lastObservationError: null,
      lastOpenedAt: '2026-06-17T16:13:51.361Z',
    }));
    expect(h.state).toBe('insufficient');
  });

  it('a newer successful observation outranks an older recorded failure', () => {
    const h = profileHealth(profile({
      baseline: baseline(),
      lastObservationError: { at: '2026-09-09T00:00:00.000Z', message: 'transient' },
      lastObservation: observation(),  // 2026-09-10, i.e. later
    }));
    expect(h.state).toBe('stable');
  });

  it('matching observation is stable', () => {
    const h = profileHealth(profile({ baseline: baseline(), lastObservation: observation() }));
    expect(h.state).toBe('stable');
    expect(h.engineChanged).toBe(false);
  });

  it('stays stable when only the engine changed and every field still matches', () => {
    const h = profileHealth(profile({ baseline: baseline(fp, '146'), lastObservation: observation(fp, '151') }));
    expect(h.state).toBe('stable');
    expect(h.engineChanged).toBe(true);
    expect(h.reason).toContain('146');
    expect(h.reason).toContain('151');
  });

  it('reports changed fields, and names an engine upgrade as the ordinary explanation', () => {
    const drifted = { ...fp, webglRenderer: 'Apple M4 Pro' };
    const h = profileHealth(profile({
      baseline: baseline(fp, '146'), lastObservation: observation(drifted, '151'),
    }));
    expect(h.state).toBe('changed');
    expect(h.changes).toEqual([{ field: 'webglRenderer', baseline: 'Apple M3 Pro', observed: 'Apple M4 Pro' }]);
    expect(h.engineChanged).toBe(true);
    expect(h.reason).toMatch(/engine/i);
  });

  it('separates the three clocks instead of reporting one age', () => {
    const h = profileHealth(profile({
      baseline: baseline(),
      lastObservation: observation(),
      diagnostics: {
        capturedAt: '2026-07-04T00:00:00.000Z', canvasHash: 'c', canvasWinding: true,
        audioHash: 'a', fontHash: 'f', fonts: [], fontsAvailable: 0, fontsTotal: 0,
        nonStandardFonts: [], warnings: [],
      },
    }));
    expect(h.acceptedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(h.observedAt).toBe('2026-09-10T00:00:00.000Z');
    expect(h.diagnosticsAt).toBe('2026-07-04T00:00:00.000Z');
  });
});
