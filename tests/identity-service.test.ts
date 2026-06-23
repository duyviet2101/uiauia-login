import { describe, it, expect, vi } from 'vitest';
import { IdentityService } from '../src/main/identity-service';
import type { Fingerprint, Profile, ProxyTestResult, ResolvedIdentity } from '../src/main/types';

const fp: Fingerprint = {
  userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en-US'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
  webglVendor: null, webglRenderer: null, timezone: 'America/New_York', webdriver: false, capturedAt: 'now',
};

function identity(over: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    lockedAt: 'now',
    cloakBrowserVersion: '146',
    seed: 1,
    platform: 'windows',
    proxy: { type: 'http', host: 'h', port: 80 },
    exitIp: '9.9.9.9',
    locale: 'en-US',
    timezone: 'America/New_York',
    webrtcIp: '9.9.9.9',
    fingerprint: fp,
    visitorId: 'vid',
    ...over,
  };
}

function profile(over: Partial<Profile> = {}): Profile {
  const resolvedIdentity = identity();
  return {
    id: 'p1',
    name: 'P',
    seed: 1,
    platform: 'windows',
    proxy: { type: 'http', host: 'h', port: 80 },
    geoip: false,
    timezone: 'America/New_York',
    locale: 'en-US',
    startUrl: null,
    userDataDir: '/tmp/p1',
    fingerprint: fp,
    visitorId: 'vid',
    diagnostics: null,
    identityLocked: true,
    resolvedIdentity,
    lastProxyCheck: null,
    blockGeolocation: true,
    doNotTrack: false,
    windowCustomization: { enabled: true, number: 1, color: '#2563EB' },
    createdAt: '',
    lastOpenedAt: null,
    ...over,
  };
}

function service(proxyResult: ProxyTestResult = { ok: true, exitIp: '9.9.9.9' }, version = '146') {
  return new IdentityService({ test: vi.fn(async () => proxyResult) } as any, () => version);
}

describe('IdentityService', () => {
  it('passes preflight when locked identity matches runtime inputs', async () => {
    await expect(service().preflightLockedIdentity(profile())).resolves.toBeUndefined();
  });

  it('blocks browser version drift', async () => {
    const result = await service({ ok: true, exitIp: '9.9.9.9' }, '147').checkLockedIdentity(profile());
    expect(result.ok).toBe(false);
    expect(result.drift.map((d) => d.field)).toContain('cloakBrowserVersion');
  });

  it('blocks proxy exit IP drift', async () => {
    const result = await service({ ok: true, exitIp: '8.8.8.8' }).checkLockedIdentity(profile());
    expect(result.ok).toBe(false);
    expect(result.drift).toContainEqual({ field: 'exitIp', expected: '9.9.9.9', actual: '8.8.8.8' });
  });

  it('blocks seed, platform, timezone, and locale drift', async () => {
    const result = await service().checkLockedIdentity(profile({
      seed: 2,
      platform: 'macos',
      timezone: 'UTC',
      locale: 'vi-VN',
    }));
    expect(result.ok).toBe(false);
    expect(result.drift.map((d) => d.field).sort()).toEqual(['locale', 'platform', 'seed', 'timezone']);
  });

  it('tolerates exit IP rotation within the same /24', async () => {
    const result = await service({ ok: true, exitIp: '9.9.9.50' }).checkLockedIdentity(profile());
    expect(result.ok).toBe(true);
    expect(result.drift).toEqual([]);
  });

  it('reuses a fresh cached proxy check instead of re-testing', async () => {
    const testFn = vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' }));
    const svc = new IdentityService({ test: testFn } as any, () => '146');
    const p = profile({ lastProxyCheck: { checkedAt: new Date().toISOString(), ok: true, exitIp: '9.9.9.9' } });
    const result = await svc.checkLockedIdentity(p);
    expect(testFn).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('re-tests when the cached proxy check is stale', async () => {
    const testFn = vi.fn(async () => ({ ok: true, exitIp: '9.9.9.9' }));
    const svc = new IdentityService({ test: testFn } as any, () => '146');
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const p = profile({ lastProxyCheck: { checkedAt: stale, ok: true, exitIp: '9.9.9.9' } });
    const result = await svc.checkLockedIdentity(p);
    expect(testFn).toHaveBeenCalledOnce();
    expect(result.fromCache).toBe(false);
  });

  it('reconcilePatch refreshes version and proxy-derived fields only', () => {
    const patch = service({ ok: true }, '999').reconcilePatch({
      checkedAt: 'now', ok: true, exitIp: '1.2.3.4', country: 'VN', timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(patch.cloakBrowserVersion).toBe('999');
    expect(patch.exitIp).toBe('1.2.3.4');
    expect(patch.webrtcIp).toBe('1.2.3.4');
    expect(patch.exitCountry).toBe('VN');
    expect(patch.seed).toBeUndefined();
    expect(patch.fingerprint).toBeUndefined();
  });

  it('builds resolved identity from launch fingerprint and proxy snapshot', () => {
    const p = profile({ identityLocked: false, resolvedIdentity: null, geoip: true, timezone: null, locale: null });
    const resolved = service().lockIdentityFromLaunch(p, fp, 'visitor', {
      checkedAt: 'now',
      ok: true,
      exitIp: '7.7.7.7',
      country: 'United States',
      timezone: 'America/New_York',
    });
    expect(resolved.exitIp).toBe('7.7.7.7');
    expect(resolved.timezone).toBe('America/New_York');
    expect(resolved.locale).toBe('en-US');
    expect(resolved.visitorId).toBe('visitor');
  });
});
