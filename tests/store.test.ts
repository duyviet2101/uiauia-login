import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProfileStore, defaultPlatformFor } from '../src/main/store';
import type { Fingerprint, ResolvedIdentity } from '../src/main/types';

async function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  let seed = 1000;
  let n = 0;
  const store = new ProfileStore(dir, { seedGen: () => ++seed, idGen: () => `id${++n}` });
  await store.init();
  return store;
}

const fakeFp: Fingerprint = {
  userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
  webglVendor: null, webglRenderer: null, timezone: 'UTC', webdriver: false, capturedAt: 'now',
};

function identity(seed: number): ResolvedIdentity {
  return {
    lockedAt: 'now',
    cloakBrowserVersion: '146',
    seed,
    platform: 'windows',
    proxy: { type: 'http', host: 'h', port: 80 },
    exitIp: '9.9.9.9',
    locale: 'en-US',
    timezone: 'UTC',
    webrtcIp: '9.9.9.9',
    fingerprint: fakeFp,
    visitorId: 'vid',
  };
}

describe('ProfileStore', () => {
  it('creates profile with generated seed, id, userDataDir', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    expect(p.id).toBe('id1');
    expect(p.seed).toBe(1001);
    expect(p.geoip).toBe(true);
    expect(p.identityLocked).toBe(false);
    expect(p.resolvedIdentity).toBeNull();
    expect(p.diagnostics).toBeNull();
    expect(p.lastProxyCheck).toBeNull();
    expect(p.windowCustomization).toEqual({ enabled: true, number: 1, color: '#2563EB' });
    expect(p.userDataDir).toContain('id1');
    expect(store.list()).toHaveLength(1);
  });

  it('update merges fields', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.update(p.id, { name: 'B', lastOpenedAt: '2026-01-01' });
    expect(store.get(p.id)!.name).toBe('B');
    expect(store.get(p.id)!.lastOpenedAt).toBe('2026-01-01');
  });

  it('duplicate creates new id, new seed, new userDataDir', async () => {
    const store = await makeStore();
    const a = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const b = await store.duplicate(a.id);
    expect(b.id).not.toBe(a.id);
    expect(b.seed).not.toBe(a.seed);
    expect(b.userDataDir).not.toBe(a.userDataDir);
    expect(b.proxy).toEqual(a.proxy);
    expect(b.windowCustomization.number).toBe(2);
    expect(b.windowCustomization.color).not.toBe(a.windowCustomization.color);
  });

  it('regenerateSeed assigns new seed and clears baseline/observation/visitorId', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.acceptBaseline(p.id, fakeFp, '146', 'first-launch');
    await store.recordObservation(p.id, fakeFp, '146');
    await store.update(p.id, {
      visitorId: 'abc',
      diagnostics: {
        capturedAt: 'now',
        canvasHash: 'c',
        canvasWinding: true,
        audioHash: 'a',
        fontHash: 'f',
        fonts: [],
        fontsAvailable: 0,
        fontsTotal: 0,
        nonStandardFonts: [],
        warnings: [],
      },
    });
    const before = store.get(p.id)!.seed;
    const after = await store.regenerateSeed(p.id);
    expect(after.seed).not.toBe(before);
    expect(after.baseline).toBeNull();
    expect(after.lastObservation).toBeNull();
    expect(after.visitorId).toBeNull();
    expect(after.diagnostics).toBeNull();
  });

  it('create applies platform/startUrl defaults', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    // A new profile takes the host's own persona (see defaultPlatformFor).
    expect(p.platform).toBe(defaultPlatformFor());
    expect(p.startUrl).toBeNull();
    expect(p.visitorId).toBeNull();
    expect(p.diagnostics).toBeNull();
  });

  it('defaultPlatformFor picks the native persona per host OS', () => {
    // Spoofing Windows from a Mac was measured to add two detectable
    // contradictions without reducing cross-profile linkage.
    expect(defaultPlatformFor('darwin')).toBe('macos');
    expect(defaultPlatformFor('win32')).toBe('windows');
    expect(defaultPlatformFor('linux')).toBe('windows');
  });

  it('an explicit platform always wins over the host default', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', platform: 'windows' });
    expect(p.platform).toBe('windows');
  });

  it('migration leaves an existing profile persona untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-persona-'));
    writeFileSync(
      join(dir, 'cloak.json'),
      JSON.stringify({ profiles: [{ id: 'old', name: 'old', seed: 1, platform: 'windows', createdAt: '2026-01-01T00:00:00.000Z' }] }),
    );
    const store = new ProfileStore(dir, { defaultPlatform: 'macos' });
    await store.init();
    expect(store.get('old')?.platform).toBe('windows');
  });

  it('create defaults blockGeolocation on and doNotTrack off', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    expect(p.blockGeolocation).toBe(true);
    expect(p.doNotTrack).toBe(false);
  });

  it('create honors explicit blockGeolocation/doNotTrack input', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', blockGeolocation: false, doNotTrack: true });
    expect(p.blockGeolocation).toBe(false);
    expect(p.doNotTrack).toBe(true);
  });

  it('locked profile rejects identity-impacting updates', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    await expect(store.update(p.id, { timezone: 'Asia/Tokyo' })).rejects.toThrow('identity is locked');
    await store.update(p.id, { name: 'B' });
    expect(store.get(p.id)!.name).toBe('B');
  });

  it('allows native window customization on a locked profile and preserves its number', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    await store.update(p.id, { windowCustomization: { enabled: false, color: '#abcdef' } });
    expect(store.get(p.id)!.windowCustomization).toEqual({
      enabled: false,
      number: p.windowCustomization.number,
      color: '#ABCDEF',
    });
  });

  it('locked profile rejects regenerateSeed', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    await expect(store.regenerateSeed(p.id)).rejects.toThrow('identity is locked');
  });

  it('resetIdentity unlocks and clears snapshots without deleting profile data', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    const reset = await store.resetIdentity(p.id);
    expect(reset.identityLocked).toBe(false);
    expect(reset.resolvedIdentity).toBeNull();
    expect(reset.baseline).toBeNull();
    expect(reset.lastObservation).toBeNull();
    expect(reset.visitorId).toBeNull();
    expect(reset.diagnostics).toBeNull();
    expect(reset.userDataDir).toContain(p.id);
  });

  it('reconcileLockedIdentity refreshes locked fields but keeps seed and fingerprint', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    const seedBefore = store.get(p.id)!.seed;
    const fpBefore = store.get(p.id)!.baseline;
    const out = await store.reconcileLockedIdentity(p.id, { exitIp: '5.5.5.5', webrtcIp: '5.5.5.5', cloakBrowserVersion: '200' });
    expect(out.resolvedIdentity!.exitIp).toBe('5.5.5.5');
    expect(out.resolvedIdentity!.cloakBrowserVersion).toBe('200');
    expect(out.identityLocked).toBe(true);
    expect(out.seed).toBe(seedBefore);
    expect(out.baseline).toEqual(fpBefore);
  });

  it('reconcileLockedIdentity throws when profile is not locked', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await expect(store.reconcileLockedIdentity(p.id, { exitIp: '1.1.1.1' })).rejects.toThrow();
  });

  it('remove deletes profile', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.remove(p.id);
    expect(store.get(p.id)).toBeUndefined();
  });

  it('persists across reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const s1 = new ProfileStore(dir, { idGen: () => 'fixed', seedGen: () => 7 });
    await s1.init();
    await s1.create({ name: 'A' });
    const s2 = new ProfileStore(dir);
    await s2.init();
    expect(s2.list()).toHaveLength(1);
    expect(s2.get('fixed')!.name).toBe('A');
  });

  it('does not reuse a deleted native window number', async () => {
    const store = await makeStore();
    const first = await store.create({ name: 'A' });
    await store.remove(first.id);
    const second = await store.create({ name: 'B' });
    expect(second.windowCustomization.number).toBe(2);
  });

  it('migrates legacy profiles to stable unique window numbers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-legacy-'));
    const legacyProfile = (id: string, createdAt: string) => ({
      id, name: id, seed: 1, platform: 'windows', proxy: null, geoip: true,
      timezone: null, locale: null, startUrl: null, userDataDir: join(dir, 'profiles', id),
      fingerprint: null, visitorId: null, diagnostics: null, identityLocked: false,
      resolvedIdentity: null, lastProxyCheck: null, createdAt, lastOpenedAt: null,
    });
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 4,
      profiles: [legacyProfile('newer', '2026-02-01'), legacyProfile('older', '2026-01-01')],
    }));

    const firstLoad = new ProfileStore(dir);
    await firstLoad.init();
    expect(firstLoad.get('older')!.windowCustomization.number).toBe(1);
    expect(firstLoad.get('newer')!.windowCustomization.number).toBe(2);

    const secondLoad = new ProfileStore(dir);
    await secondLoad.init();
    expect(secondLoad.get('older')!.windowCustomization.number).toBe(1);
    expect(secondLoad.get('newer')!.windowCustomization.number).toBe(2);
  });

  it('migrates legacy profiles to default blockGeolocation + doNotTrack', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-privacy-'));
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 5,
      profiles: [{
        id: 'legacy', name: 'legacy', seed: 1, platform: 'windows', proxy: null, geoip: true,
        timezone: null, locale: null, startUrl: null, userDataDir: join(dir, 'profiles', 'legacy'),
        fingerprint: null, visitorId: null, diagnostics: null, identityLocked: false,
        resolvedIdentity: null, lastProxyCheck: null,
        windowCustomization: { enabled: true, number: 1, color: '#2563EB' },
        createdAt: '2026-01-01', lastOpenedAt: null,
      }],
    }));

    const store = new ProfileStore(dir);
    await store.init();
    const p = store.get('legacy')!;
    expect(p.blockGeolocation).toBe(true);
    expect(p.doNotTrack).toBe(false);
  });

  it('backfills nonStandardFonts on diagnostics saved before v0.4.0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-diag-'));
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 6,
      profiles: [{
        id: 'legacy', name: 'legacy', seed: 1, platform: 'windows', proxy: null, geoip: true,
        timezone: null, locale: null, startUrl: null, userDataDir: join(dir, 'profiles', 'legacy'),
        fingerprint: null, visitorId: null, identityLocked: false, resolvedIdentity: null, lastProxyCheck: null,
        blockGeolocation: true, doNotTrack: false,
        // diagnostics shape before nonStandardFonts existed
        diagnostics: {
          capturedAt: 'now', canvasHash: 'c', canvasWinding: true, audioHash: 'a', fontHash: 'f',
          fonts: [{ family: 'Arial', available: true }], fontsAvailable: 1, fontsTotal: 1, warnings: [],
        },
        windowCustomization: { enabled: true, number: 1, color: '#2563EB' },
        createdAt: '2026-01-01', lastOpenedAt: null,
      }],
    }));

    const store = new ProfileStore(dir);
    await store.init();
    expect(store.get('legacy')!.diagnostics!.nonStandardFonts).toEqual([]);
  });
  // ---------------------------------------------------------------------------
  // v7 -> v8: one `fingerprint` field became an accepted baseline plus a latest
  // observation. The migration must not invent an observation it never made.
  // ---------------------------------------------------------------------------
  it('migrates a v7 fingerprint into an accepted baseline, with no observation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-v8-'));
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 7,
      profiles: [{
        id: 'old', name: 'old', seed: 4242042, platform: 'macos', proxy: null, geoip: true,
        timezone: null, locale: null, startUrl: null, userDataDir: join(dir, 'profiles', 'old'),
        fingerprint: fakeFp, visitorId: null, diagnostics: null, identityLocked: false,
        resolvedIdentity: null, lastProxyCheck: null, blockGeolocation: true, doNotTrack: false,
        createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-02-01T00:00:00.000Z',
      }],
    }));
    const store = new ProfileStore(dir, { defaultPlatform: 'windows' });
    await store.init();
    const p = store.get('old')!;

    expect(p.baseline?.fingerprint).toEqual(fakeFp);
    expect(p.baseline?.source).toBe('first-launch');
    // The shape it came FROM, not the shape it is being read into.
    expect(p.baseline?.schemaVersion).toBe(7);
    // Nobody recorded which engine produced it, and pretending otherwise would
    // make the next comparison silently wrong.
    expect(p.baseline?.engineVersion).toBe('unknown');
    // No reading was ever taken after the baseline, so there is no observation.
    expect(p.lastObservation).toBeNull();
    // The point of the migration test: identity fields survive untouched.
    expect(p.seed).toBe(4242042);
    expect(p.platform).toBe('macos');
    expect((p as unknown as Record<string, unknown>).fingerprint).toBeUndefined();
  });

  it('migrates a v7 profile with no fingerprint to a null baseline, not an empty one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-v8-empty-'));
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 7,
      profiles: [{
        id: 'fresh', name: 'fresh', seed: 7, platform: 'windows', proxy: null, geoip: true,
        timezone: null, locale: null, startUrl: null, userDataDir: join(dir, 'profiles', 'fresh'),
        fingerprint: null, visitorId: null, diagnostics: null, identityLocked: false,
        resolvedIdentity: null, lastProxyCheck: null, blockGeolocation: true, doNotTrack: false,
        createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null,
      }],
    }));
    const store = new ProfileStore(dir);
    await store.init();
    expect(store.get('fresh')!.baseline).toBeNull();
  });

  it('recordObservation never touches the baseline', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.acceptBaseline(p.id, fakeFp, '146', 'first-launch');

    const drifted = { ...fakeFp, userAgent: 'something else', capturedAt: 'later' };
    await store.recordObservation(p.id, drifted, '151');

    const after = store.get(p.id)!;
    expect(after.baseline!.fingerprint).toEqual(fakeFp);   // unchanged
    expect(after.baseline!.engineVersion).toBe('146');     // unchanged
    expect(after.lastObservation!.fingerprint).toEqual(drifted);
    expect(after.lastObservation!.engineVersion).toBe('151');
  });

  it('refuses an automatic first-launch baseline when one already exists', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.acceptBaseline(p.id, fakeFp, '146', 'first-launch');
    await expect(store.acceptBaseline(p.id, fakeFp, '151', 'first-launch'))
      .rejects.toThrow(/already has an accepted baseline/i);
    // An explicit user acceptance is allowed to replace it.
    const next = await store.acceptBaseline(p.id, fakeFp, '151', 'user-accepted');
    expect(next.engineVersion).toBe('151');
    expect(store.get(p.id)!.baseline!.source).toBe('user-accepted');
  });
  it('records the true prior schema version on a baseline promoted from very old data', async () => {
    // The user's own store was still at v2. Stamping "7" on it would have been a
    // guess dressed up as a record.
    const dir = mkdtempSync(join(tmpdir(), 'cloak-v2-'));
    writeFileSync(join(dir, 'cloak.json'), JSON.stringify({
      version: 2,
      profiles: [{
        id: 'ancient', name: 'ancient', seed: 12345678, platform: 'windows',
        proxy: null, geoip: true, timezone: null, locale: null,
        userDataDir: join(dir, 'profiles', 'ancient'), fingerprint: fakeFp,
        createdAt: '2026-06-17T16:13:51.361Z', lastOpenedAt: null,
      }],
    }));
    const store = new ProfileStore(dir, { defaultPlatform: 'macos' });
    await store.init();
    const p = store.get('ancient')!;
    expect(p.baseline?.schemaVersion).toBe(2);
    expect(p.baseline?.fingerprint).toEqual(fakeFp);
    expect(p.lastObservation).toBeNull();
    // A Mac host default must not re-persona an existing Windows profile.
    expect(p.platform).toBe('windows');
    expect(p.seed).toBe(12345678);
  });
});
