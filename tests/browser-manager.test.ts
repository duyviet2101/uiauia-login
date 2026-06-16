import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ProfileStore } from '../src/main/store';
import { BrowserManager } from '../src/main/browser-manager';
import type { Fingerprint } from '../src/main/types';

function fakeContext() {
  const ee = new EventEmitter() as any;
  ee.close = vi.fn(async () => ee.emit('close'));
  return ee;
}

const fakeFp: Fingerprint = {
  userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
  webglVendor: null, webglRenderer: null, timezone: 'UTC', webdriver: false, capturedAt: 'now',
};

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
  await store.init();
  await store.create({ name: 'A' });
  const ctx = fakeContext();
  const launcher = vi.fn(async () => ctx);
  const capture = vi.fn(async () => fakeFp);
  const mgr = new BrowserManager(store, launcher, capture);
  return { store, mgr, ctx, launcher, capture };
}

describe('BrowserManager', () => {
  it('launch calls launcher with fingerprint seed arg and tracks running', async () => {
    const { mgr, launcher } = await setup();
    await mgr.launch('p1');
    expect(launcher).toHaveBeenCalledOnce();
    expect(launcher.mock.calls[0][0].args).toContain('--fingerprint=9');
    expect(mgr.isRunning('p1')).toBe(true);
  });

  it('captures fingerprint on first launch and persists', async () => {
    const { mgr, store, capture } = await setup();
    await mgr.launch('p1');
    expect(capture).toHaveBeenCalledOnce();
    expect(store.get('p1')!.fingerprint).toEqual(fakeFp);
  });

  it('skips capture when fingerprint already present', async () => {
    const { mgr, store, capture } = await setup();
    await store.update('p1', { fingerprint: fakeFp });
    await mgr.launch('p1');
    expect(capture).not.toHaveBeenCalled();
  });

  it('context close marks stopped and emits status-changed', async () => {
    const { mgr, ctx } = await setup();
    const onChange = vi.fn();
    mgr.on('status-changed', onChange);
    await mgr.launch('p1');
    ctx.emit('close');
    expect(mgr.isRunning('p1')).toBe(false);
    expect(onChange).toHaveBeenCalledWith('p1', false);
  });

  it('stop closes context', async () => {
    const { mgr, ctx } = await setup();
    await mgr.launch('p1');
    await mgr.stop('p1');
    expect(ctx.close).toHaveBeenCalled();
    expect(mgr.isRunning('p1')).toBe(false);
  });
});
