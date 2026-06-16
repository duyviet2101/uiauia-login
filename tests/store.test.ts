import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProfileStore } from '../src/main/store';

async function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  let seed = 1000;
  let n = 0;
  const store = new ProfileStore(dir, { seedGen: () => ++seed, idGen: () => `id${++n}` });
  await store.init();
  return store;
}

describe('ProfileStore', () => {
  it('creates profile with generated seed, id, userDataDir', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    expect(p.id).toBe('id1');
    expect(p.seed).toBe(1001);
    expect(p.geoip).toBe(true);
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
