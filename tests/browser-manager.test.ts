import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The engine the binary "reports" during these tests.
 *
 * BrowserManager asks on every launch, and the real implementation execs
 * Chromium — which a unit test must not do. Only `readEngineInfo` is replaced;
 * the comparison helpers stay real, so these tests exercise the actual matching
 * logic rather than a stub of it.
 */
const engineState = vi.hoisted(() => ({
  current: {
    markerVersion: '146', binaryVersion: '146' as string | null, bundledVersion: '146',
    tier: 'free', platform: 'test', binaryPath: '/fake/chrome',
    installed: true, requestedVersion: null as string | null, verified: true,
    problems: [] as { kind: string; message: string }[],
  },
}));

vi.mock('../src/main/engine-info', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/engine-info')>()),
  readEngineInfo: async () => engineState.current,
}));

function setEngine(over: Partial<typeof engineState.current>): void {
  engineState.current = { ...engineState.current, ...over };
}
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ProfileStore } from '../src/main/store';
import { BrowserManager } from '../src/main/browser-manager';
import type { Fingerprint, FingerprintDiagnostics, ProxyTestResult } from '../src/main/types';
import { EngineMismatchError, IdentityDriftError, ProxyPreflightError } from '../src/main/types';
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
  nonStandardFonts: [],
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
  beforeEach(() => {
    setEngine({
      markerVersion: '146', binaryVersion: '146', verified: true, installed: true, problems: [],
    });
  });

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

  it('captures fingerprint on first launch and accepts it as the baseline', async () => {
    const { mgr, store, capture } = await setup();
    await mgr.launch('p1');
    expect(capture).toHaveBeenCalledOnce();
    const p = store.get('p1')!;
    expect(p.baseline?.fingerprint).toEqual(fakeFp);
    expect(p.baseline?.source).toBe('first-launch');
    expect(p.lastObservation?.fingerprint).toEqual(fakeFp);
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
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    await store.update('p1', { lastOpenedAt: '2026-06-22T00:00:00.000Z' });
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
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    await store.update('p1', { lastOpenedAt: '2026-06-22T00:00:00.000Z' });
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

  // Behaviour change: the probe used to run ONLY when the profile had no
  // fingerprint yet, so after the first launch the app never looked again and
  // could not have noticed a change if one happened.
  it('re-reads the fingerprint on every launch, without touching the baseline', async () => {
    const { mgr, store, capture } = await setup();
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    const acceptedAt = store.get('p1')!.baseline!.acceptedAt;

    await mgr.launch('p1');

    expect(capture).toHaveBeenCalledOnce();
    const p = store.get('p1')!;
    expect(p.lastObservation?.fingerprint).toEqual(fakeFp);
    expect(p.baseline!.acceptedAt).toBe(acceptedAt); // baseline untouched
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
    const lockedFp = store.get('p1')!.baseline;
    const lockedSeed = store.get('p1')!.seed;

    ip = '5.5.5.5'; // proxy rotated to a different /24
    await mgr.forceLaunch('p1');

    const p = store.get('p1')!;
    expect(p.identityLocked).toBe(true);
    expect(p.resolvedIdentity?.exitIp).toBe('5.5.5.5');
    expect(p.resolvedIdentity?.webrtcIp).toBe('5.5.5.5');
    expect(p.seed).toBe(lockedSeed);
    expect(p.baseline).toEqual(lockedFp);
  });

  it('forceLaunch REFUSES to open on a changed engine unless the caller accepts it', async () => {
    // Reported by review: keeping the old version number in the store does not
    // keep the old binary on disk. `force` skipped the whole identity check, so
    // "Mở & cập nhật IP" opened the profile on the NEW engine while the record
    // and the toast both said the engine was untouched. The old version of this
    // test only asserted the stored number and let that through.
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    let version = '146';
    const identity = new IdentityService(
      { test: vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' })) } as any,
      () => version,
    );
    const launcher = vi.fn(async () => fakeContext());
    const mgr = new BrowserManager(store, launcher, vi.fn(async () => fakeFp), undefined, identity);

    await mgr.launch('p1'); // auto-lock on engine 146
    await mgr.stop('p1');

    // The engine was replaced underneath the profile.
    version = '999';
    setEngine({ markerVersion: '999', binaryVersion: '999' });
    const launchesBefore = launcher.mock.calls.length;

    await expect(mgr.forceLaunch('p1')).rejects.toBeInstanceOf(IdentityDriftError);
    expect(launcher.mock.calls.length).toBe(launchesBefore); // no browser opened
    expect(store.get('p1')!.resolvedIdentity?.cloakBrowserVersion).toBe('146');
    expect(store.get('p1')!.resolvedIdentity?.engineAcceptedAt).toBeUndefined();

    // Accepting the engine is a separate, explicit decision — and only then does
    // the profile open.
    await mgr.forceLaunch('p1', { acceptEngine: true });
    expect(launcher.mock.calls.length).toBe(launchesBefore + 1);
    expect(store.get('p1')!.resolvedIdentity?.cloakBrowserVersion).toBe('999');
    expect(store.get('p1')!.resolvedIdentity?.engineAcceptedAt).toBeTruthy();
  });

  it('names the RUNNING engine in the drift, not the package marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const identity = new IdentityService(
      { test: vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' })) } as any,
      () => '146',
    );
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => fakeFp), undefined, identity);
    await mgr.launch('p1');
    await mgr.stop('p1');

    // The package still resolves 146; the file on disk is something else. This
    // is the case the marker alone can never see.
    setEngine({ markerVersion: '146', binaryVersion: '151.0.7922.108' });

    await expect(mgr.launch('p1')).rejects.toMatchObject({
      drift: [{ field: 'cloakBrowserVersion', expected: '146', actual: '151.0.7922.108' }],
    });
  });

  it('blocks every launch when the engine problem is definite', async () => {
    const { mgr, launcher } = await setup();
    setEngine({
      problems: [{ kind: 'version-mismatch', message: 'package says 146, binary says 151' }],
    });
    await expect(mgr.launch('p1')).rejects.toBeInstanceOf(EngineMismatchError);
    expect(launcher).not.toHaveBeenCalled();
  });

  it('does not block on an unreadable binary, but refuses to LOCK an identity onto it', async () => {
    // A binary that will not answer --version may still be the right one, so
    // refusing every launch would be the worse trade. Baselining an identity
    // onto an engine we cannot name is a different matter.
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const identity = new IdentityService(
      { test: vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' })) } as any,
      () => '146',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setEngine({
      binaryVersion: null,
      verified: false,
      problems: [{ kind: 'unreadable', message: 'no answer' }],
    });
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => fakeFp), undefined, identity);

    const result = await mgr.launch('p1');
    expect(result.launched).toBe(true);
    expect(result.lockedNow).toBe(false);
    expect(store.get('p1')!.identityLocked).toBe(false);
    warn.mockRestore();
  });

  it('acceptEngineVersion re-baselines the engine without launching', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const ctx = fakeContext();
    const launcher = vi.fn(async () => ctx);
    let version = '146';
    const identity = new IdentityService(
      { test: vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' })) } as any,
      () => version,
    );
    const mgr = new BrowserManager(store, launcher, vi.fn(async () => fakeFp), undefined, identity);

    await mgr.launch('p1');
    await mgr.stop('p1');
    const launchesBefore = launcher.mock.calls.length;
    version = '999';

    const accepted = await mgr.acceptEngineVersion('p1');
    expect(accepted).toBe('999');
    expect(store.get('p1')!.resolvedIdentity?.cloakBrowserVersion).toBe('999');
    expect(store.get('p1')!.baseline?.fingerprint).toEqual(fakeFp); // baseline untouched
    expect(launcher.mock.calls.length).toBe(launchesBefore); // no browser opened
  });

  it('acceptEngineVersion refuses a profile that is not locked', async () => {
    const { mgr } = await setup();
    await expect(mgr.acceptEngineVersion('p1')).rejects.toThrow(/not locked/i);
  });

  it('precheckProxy returns tested:false and runs no test for a proxyless profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A' }); // no proxy
    const test = vi.fn(async () => ({ ok: true, exitIp: '1.1.1.1' }));
    const identity = new IdentityService({ test } as any, () => '146');
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => fakeFp), undefined, identity);

    const result = await mgr.precheckProxy('p1');
    expect(result).toEqual({ tested: false, ok: true });
    expect(test).not.toHaveBeenCalled();
  });

  it('precheckProxy tests the proxy, returns ok, and caches the snapshot for TTL reuse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const test = vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' }));
    const identity = new IdentityService({ test } as any, () => '146');
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => fakeFp), undefined, identity);

    const result = await mgr.precheckProxy('p1');
    expect(result.tested).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.snapshot?.exitIp).toBe('9.9.9.9');
    expect(test).toHaveBeenCalledOnce();
    // cached so the locked-launch preflight immediately after reuses it (no 2nd test)
    expect(store.get('p1')!.lastProxyCheck?.exitIp).toBe('9.9.9.9');
  });

  it('precheckProxy returns ok:false with the error when the proxy is down', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const test = vi.fn(async () => ({ ok: false, error: 'proxy unreachable' }));
    const identity = new IdentityService({ test } as any, () => '146');
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => fakeFp), undefined, identity);

    const result = await mgr.precheckProxy('p1');
    expect(result).toMatchObject({ tested: true, ok: false, error: 'proxy unreachable' });
  });
  // -------------------------------------------------------------------------
  // Preflight: nothing may reach the network before the gate has run.
  //
  // buildLaunchArgs passes --restore-last-session, so launchPersistentContext
  // replays the profile's previous tabs by itself. Any check that runs after it
  // is not a gate. These tests pin the ordering, not just the outcome.
  // -------------------------------------------------------------------------
  async function setupPreflight(proxyResult: ProxyTestResult, opts: { returning?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
    await store.init();
    await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    if (opts.returning) await store.update('p1', { lastOpenedAt: new Date().toISOString() });
    const order: string[] = [];
    const test = vi.fn(async () => { order.push('proxy-test'); return proxyResult; });
    const launcher = vi.fn(async () => { order.push('launch'); return fakeContext(); });
    const identity = new IdentityService({ test } as any, () => '146');
    const mgr = new BrowserManager(store, launcher, vi.fn(async () => fakeFp), undefined, identity);
    return { store, mgr, launcher, test, order };
  }

  it('tests the proxy of an unlocked profile BEFORE opening the browser', async () => {
    const { mgr, order } = await setupPreflight({ ok: true, exitIp: '9.9.9.9' });
    await mgr.launch('p1');
    // Before the fix the proxy was only tested after launch, to decide locking.
    expect(order).toEqual(['proxy-test', 'launch']);
  });

  it('blocks a returning profile whose proxy is down, without launching', async () => {
    const { mgr, launcher } = await setupPreflight({ ok: false, error: 'proxy unreachable' }, { returning: true });
    await expect(mgr.launch('p1')).rejects.toBeInstanceOf(ProxyPreflightError);
    // The session would have been restored the moment this ran.
    expect(launcher).not.toHaveBeenCalled();
  });

  it('lets a first launch through on a dead proxy — there is no session to replay', async () => {
    const { mgr, launcher } = await setupPreflight({ ok: false, error: 'proxy unreachable' });
    await expect(mgr.launch('p1')).resolves.toMatchObject({ launched: true, lockedNow: false });
    expect(launcher).toHaveBeenCalledOnce();
  });

  it('blocks a forced launch too — force accepts drift, not an unverified exit', async () => {
    const { store, mgr, launcher } = await setupPreflight({ ok: false, error: 'proxy unreachable' }, { returning: true });
    await store.lockIdentity('p1', {
      lockedAt: 'now', cloakBrowserVersion: '146', seed: 9, platform: 'windows',
      proxy: { type: 'http', host: 'h', port: 80 }, exitIp: '9.9.9.9', locale: null,
      timezone: null, webrtcIp: '9.9.9.9', fingerprint: fakeFp, visitorId: null,
    }, { checkedAt: 'now', ok: true, exitIp: '9.9.9.9' });

    await expect(mgr.forceLaunch('p1')).rejects.toBeInstanceOf(ProxyPreflightError);
    expect(launcher).not.toHaveBeenCalled();
  });

  it('reuses a fresh proxy check from the precheck instead of testing twice', async () => {
    const { mgr, test } = await setupPreflight({ ok: true, exitIp: '9.9.9.9' }, { returning: true });
    await mgr.precheckProxy('p1');
    await mgr.launch('p1');
    expect(test).toHaveBeenCalledOnce();
  });

  it('re-tests rather than trusting a cached FAILED proxy check', async () => {
    const { store, mgr, test } = await setupPreflight({ ok: true, exitIp: '9.9.9.9' }, { returning: true });
    await store.setLastProxyCheck('p1', { checkedAt: new Date().toISOString(), ok: false, error: 'was down' });
    await mgr.launch('p1');
    // A failure is not evidence of anything; only a successful check may be reused.
    expect(test).toHaveBeenCalledOnce();
  });
  // -------------------------------------------------------------------------
  // Baseline vs observation (plan §16.3)
  // -------------------------------------------------------------------------
  it('records a differing observation without promoting it to the baseline', async () => {
    const { store } = await setup();
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    const drifted = { ...fakeFp, webglRenderer: 'Apple M4 Pro' };
    const ctx = fakeContext();
    const mgr = new BrowserManager(store, vi.fn(async () => ctx), vi.fn(async () => drifted));

    await mgr.launch('p1');

    const p = store.get('p1')!;
    expect(p.baseline!.fingerprint).toEqual(fakeFp);          // still the accepted one
    expect(p.lastObservation!.fingerprint).toEqual(drifted);  // and we can see the difference
  });

  it('acceptCurrentFingerprint adopts the latest observation, explicitly', async () => {
    const { store } = await setup();
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    const drifted = { ...fakeFp, webglRenderer: 'Apple M4 Pro' };
    const mgr = new BrowserManager(store, vi.fn(async () => fakeContext()), vi.fn(async () => drifted));
    await mgr.launch('p1');

    const accepted = await mgr.acceptCurrentFingerprint('p1');
    expect(accepted.source).toBe('user-accepted');
    expect(store.get('p1')!.baseline!.fingerprint).toEqual(drifted);
  });

  it('refuses to accept a baseline when nothing has been measured', async () => {
    const { mgr } = await setup();
    // Writing the old baseline back over itself and reporting success would be
    // worse than refusing.
    await expect(mgr.acceptCurrentFingerprint('p1')).rejects.toThrow(/Chưa có lần đo/);
  });

  it('a failed fingerprint read leaves the previous observation alone', async () => {
    const { store } = await setup();
    await store.acceptBaseline('p1', fakeFp, '146', 'first-launch');
    await store.recordObservation('p1', fakeFp, '146');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new BrowserManager(
      store,
      vi.fn(async () => fakeContext()),
      vi.fn(async () => { throw new Error('probe blew up'); }),
    );

    await expect(mgr.launch('p1')).resolves.toMatchObject({ launched: true });

    // Not overwritten with nothing, and not silently reported as unchanged.
    const p = store.get('p1')!;
    expect(p.lastObservation!.fingerprint).toEqual(fakeFp);
    // The failure is RECORDED, so health can say a check failed rather than
    // inferring it from an absence.
    expect(p.lastObservationError?.message).toContain('probe blew up');
    warn.mockRestore();
  });
});
