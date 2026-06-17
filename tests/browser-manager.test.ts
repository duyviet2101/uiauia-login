import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ProfileStore } from '../src/main/store';
import { BrowserManager } from '../src/main/browser-manager';
import type { Fingerprint } from '../src/main/types';
import { IdentityService } from '../src/main/identity-service';

function fakeContext() {
  const page = {
    goto: vi.fn(async () => null),
    evaluate: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
  };
  const ee = new EventEmitter() as any;
  ee.close = vi.fn(async () => ee.emit('close'));
  ee.pages = () => [page];
  ee.newPage = vi.fn(async () => page);
  ee.page = page;
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

async function setupWithProxy() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
  await store.init();
  await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
  const ctx = fakeContext();
  const launcher = vi.fn(async () => ctx);
  const capture = vi.fn(async () => fakeFp);
  const identity = new IdentityService({ test: vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' })) } as any, () => '146');
  const mgr = new BrowserManager(store, launcher, capture, vi.fn(async () => 'visitor'), identity);
  return { store, mgr };
}

describe('BrowserManager', () => {
  it('launch calls launcher with fingerprint seed arg and tracks running', async () => {
    const { mgr, launcher } = await setup();
    await mgr.launch('p1');
    expect(launcher).toHaveBeenCalledOnce();
    expect((launcher.mock.calls[0] as any[])[0].args).toContain('--fingerprint=9');
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

  it('auto-locks identity after first successful proxied launch', async () => {
    const { mgr, store } = await setupWithProxy();
    const result = await mgr.launch('p1');
    const p = store.get('p1')!;
    expect(result.lockedNow).toBe(true);
    expect(p.identityLocked).toBe(true);
    expect(p.resolvedIdentity?.exitIp).toBe('9.9.9.9');
    expect(p.resolvedIdentity?.cloakBrowserVersion).toBe('146');
    expect(p.geoip).toBe(false);
  });

  it('forceLaunch reconciles locked identity to current IP and keeps fingerprint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const ctx = fakeContext();
    const launcher = vi.fn(async () => ctx);
    let ip = '9.9.9.9';
    const identity = new IdentityService({ test: vi.fn(async () => ({ ok: true, exitIp: ip })) } as any, () => '146');
    const mgr = new BrowserManager(store, launcher, vi.fn(async () => fakeFp), vi.fn(async () => 'visitor'), identity);

    await mgr.launch('p1'); // auto-lock at 9.9.9.9
    await mgr.stop('p1');
    const lockedFp = store.get('p1')!.fingerprint;
    const lockedSeed = store.get('p1')!.seed;

    ip = '5.5.5.5'; // proxy rotated to a different /24
    await mgr.forceLaunch('p1');

    const p = store.get('p1')!;
    expect(p.identityLocked).toBe(true);
    expect(p.resolvedIdentity?.exitIp).toBe('5.5.5.5');
    expect(p.resolvedIdentity?.webrtcIp).toBe('5.5.5.5');
    expect(p.seed).toBe(lockedSeed);
    expect(p.fingerprint).toEqual(lockedFp);
  });
});
