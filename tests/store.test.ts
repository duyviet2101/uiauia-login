import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProfileStore } from '../src/main/store';
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
  });

  it('regenerateSeed assigns new seed and clears cached fingerprint/visitorId', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.update(p.id, {
      fingerprint: {
        ...fakeFp,
      },
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
        warnings: [],
      },
    });
    const before = store.get(p.id)!.seed;
    const after = await store.regenerateSeed(p.id);
    expect(after.seed).not.toBe(before);
    expect(after.fingerprint).toBeNull();
    expect(after.visitorId).toBeNull();
    expect(after.diagnostics).toBeNull();
  });

  it('create applies platform/startUrl defaults', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    expect(p.platform).toBe('windows');
    expect(p.startUrl).toBeNull();
    expect(p.visitorId).toBeNull();
    expect(p.diagnostics).toBeNull();
  });

  it('locked profile rejects identity-impacting updates', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    await expect(store.update(p.id, { timezone: 'Asia/Tokyo' })).rejects.toThrow('identity is locked');
    await store.update(p.id, { name: 'B' });
    expect(store.get(p.id)!.name).toBe('B');
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
    expect(reset.fingerprint).toBeNull();
    expect(reset.visitorId).toBeNull();
    expect(reset.diagnostics).toBeNull();
    expect(reset.userDataDir).toContain(p.id);
  });

  it('reconcileLockedIdentity refreshes locked fields but keeps seed and fingerprint', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    await store.lockIdentity(p.id, identity(p.seed));
    const seedBefore = store.get(p.id)!.seed;
    const fpBefore = store.get(p.id)!.fingerprint;
    const out = await store.reconcileLockedIdentity(p.id, { exitIp: '5.5.5.5', webrtcIp: '5.5.5.5', cloakBrowserVersion: '200' });
    expect(out.resolvedIdentity!.exitIp).toBe('5.5.5.5');
    expect(out.resolvedIdentity!.cloakBrowserVersion).toBe('200');
    expect(out.identityLocked).toBe(true);
    expect(out.seed).toBe(seedBefore);
    expect(out.fingerprint).toEqual(fpBefore);
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
});
