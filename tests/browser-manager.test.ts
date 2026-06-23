import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ProfileStore } from '../src/main/store';
import { BrowserManager } from '../src/main/browser-manager';
import type { Fingerprint, FingerprintDiagnostics } from '../src/main/types';
import { IdentityService } from '../src/main/identity-service';

function fakeContext(url = 'about:blank') {
  const page = {
    goto: vi.fn(async () => null),
    evaluate: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
    url: vi.fn(() => url),
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

const fakeDiagnostics: FingerprintDiagnostics = {
  capturedAt: 'now',
  canvasHash: 'canvas',
  canvasWinding: true,
  audioHash: 'audio',
  fontHash: 'fonts',
  fonts: [{ family: 'Arial', available: true }],
  fontsAvailable: 1,
  fontsTotal: 1,
  warnings: [],
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
  const mgr = new BrowserManager(store, launcher, capture, undefined, identity);
  return { store, mgr };
}

describe('BrowserManager', () => {
  it('keeps launch successful when native window customization is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A' });
    const ctx = fakeContext();
    const windowService = {
      attach: vi.fn(async () => { throw new Error('native unavailable'); }),
      refresh: vi.fn(async () => {}),
      detach: vi.fn(),
      dispose: vi.fn(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new BrowserManager(
      store,
      vi.fn(async () => ctx),
      vi.fn(async () => fakeFp),
      undefined,
      undefined,
      undefined,
      windowService,
    );

    await expect(mgr.launch('p1')).resolves.toMatchObject({ launched: true });
    expect(windowService.attach).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('launch calls launcher with fingerprint seed arg and tracks running', async () => {
    const { mgr, launcher } = await setup();
    await mgr.launch('p1');
    expect(launcher).toHaveBeenCalledOnce();
    expect((launcher.mock.calls[0] as any[])[0].args).toContain('--fingerprint=9');
    expect(mgr.isRunning('p1')).toBe(true);
  });

  it('seeds geo-block + DNT preferences with the profile settings before launching', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', blockGeolocation: true, doNotTrack: true });
    const ctx = fakeContext();
    const order: string[] = [];
    const launcher = vi.fn(async () => { order.push('launch'); return ctx; });
    const prefsPreparer = vi.fn(() => { order.push('prefs'); });
    const mgr = new BrowserManager(
      store,
      launcher,
      vi.fn(async () => fakeFp),
      undefined,
      undefined,
      undefined,
      undefined,
      prefsPreparer,
    );

    await mgr.launch('p1');

    expect(prefsPreparer).toHaveBeenCalledWith(
      store.get('p1')!.userDataDir,
      { blockGeolocation: true, doNotTrack: true },
    );
    expect(order).toEqual(['prefs', 'launch']);
  });

  it('passes the resolved Windows fonts dir into the launcher for a windows profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', platform: 'windows' });
    const ctx = fakeContext();
    const launcher = vi.fn(async () => ctx);
    const mgr = new BrowserManager(
      store,
      launcher,
      vi.fn(async () => fakeFp),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => '/bundled/fonts',
    );

    await mgr.launch('p1');

    expect((launcher.mock.calls[0] as any[])[0].args).toContain('--fingerprint-fonts-dir=/bundled/fonts');
  });

  it('captures fingerprint on first launch and persists', async () => {
    const { mgr, store, capture } = await setup();
    await mgr.launch('p1');
    expect(capture).toHaveBeenCalledOnce();
    expect(store.get('p1')!.fingerprint).toEqual(fakeFp);
  });

  it('does not run external FingerprintJS visitor probe during normal launch', async () => {
    const { mgr, store, ctx } = await setup();
    await mgr.launch('p1');
    expect(store.get('p1')!.visitorId).toBeNull();
    expect(ctx.page.goto).not.toHaveBeenCalledWith('https://example.com');
  });

  it('keeps a restored page instead of replacing it with the default start URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A' });
    await store.update('p1', { fingerprint: fakeFp, lastOpenedAt: '2026-06-22T00:00:00.000Z' });
    const ctx = fakeContext('https://example.com/account');
    const mgr = new BrowserManager(store, vi.fn(async () => ctx));

    await mgr.launch('p1');
    expect(ctx.page.goto).not.toHaveBeenCalled();
  });

  it('closes Playwright bootstrap about:blank tabs after restoring a real page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A' });
    await store.update('p1', { fingerprint: fakeFp, lastOpenedAt: '2026-06-22T00:00:00.000Z' });
    const blank = {
      url: vi.fn(() => 'about:blank'),
      close: vi.fn(async () => {}),
    };
    const restored = {
      url: vi.fn(() => 'https://example.com/account'),
      close: vi.fn(async () => {}),
      goto: vi.fn(async () => null),
    };
    const ctx = new EventEmitter() as any;
    ctx.pages = () => [blank, restored];
    ctx.newPage = vi.fn(async () => restored);
    ctx.close = vi.fn(async () => ctx.emit('close'));
    const mgr = new BrowserManager(store, vi.fn(async () => ctx));

    await mgr.launch('p1');
    expect(blank.close).toHaveBeenCalledOnce();
    expect(restored.close).not.toHaveBeenCalled();
  });

  it('runDiagnostics captures and persists local diagnostics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A' });
    const ctx = fakeContext();
    const mgr = new BrowserManager(
      store,
      vi.fn(async () => ctx),
      vi.fn(async () => fakeFp),
      vi.fn(async () => fakeDiagnostics),
    );
    const diagnostics = await mgr.runDiagnostics('p1');
    expect(diagnostics).toEqual(fakeDiagnostics);
    expect(store.get('p1')!.diagnostics).toEqual(fakeDiagnostics);
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
    const mgr = new BrowserManager(store, launcher, vi.fn(async () => fakeFp), undefined, identity);

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
