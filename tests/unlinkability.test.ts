import { describe, it, expect } from 'vitest';
import { findProxyConflicts, proxyWarnings } from '../src/main/unlinkability';
import type { Profile } from '../src/main/types';

function profile(id: string, host: string | null, port = 8080): Profile {
  return {
    id, name: id, seed: 1, platform: 'windows', geoip: true, timezone: null, locale: null,
    startUrl: null, userDataDir: '/d/' + id, fingerprint: null, visitorId: null, diagnostics: null,
    identityLocked: false, resolvedIdentity: null, lastProxyCheck: null,
    blockGeolocation: true, doNotTrack: false,
    windowCustomization: { enabled: true, number: 1, color: '#2563EB' },
    createdAt: '', lastOpenedAt: null,
    proxy: host ? { type: 'http', host, port } : null,
  };
}

function lockedProfile(id: string, exitIp: string, host = id): Profile {
  const p = profile(id, host);
  const fingerprint = {
    userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
    languages: ['en'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
    webglVendor: null, webglRenderer: null, timezone: 'UTC', webdriver: false, capturedAt: 'now',
  };
  return {
    ...p,
    identityLocked: true,
    resolvedIdentity: {
      lockedAt: 'now',
      cloakBrowserVersion: '146',
      seed: p.seed,
      platform: p.platform,
      proxy: p.proxy!,
      exitIp,
      locale: 'en-US',
      timezone: 'UTC',
      webrtcIp: exitIp,
      fingerprint,
      visitorId: null,
    },
    lastProxyCheck: { checkedAt: 'now', ok: true, exitIp, country: 'US', city: 'NYC', asn: '1', isp: 'ISP' },
  };
}

describe('findProxyConflicts', () => {
  it('returns ids sharing same host:port', () => {
    const profiles = [profile('a', '1.1.1.1'), profile('b', '1.1.1.1'), profile('c', '2.2.2.2')];
    expect(findProxyConflicts(profiles)).toEqual([['a', 'b']]);
  });
  it('no conflicts => empty', () => {
    expect(findProxyConflicts([profile('a', '1.1.1.1'), profile('b', '2.2.2.2')])).toEqual([]);
  });
});

describe('proxyWarnings', () => {
  it('flags no-proxy profile as high risk', () => {
    const w = proxyWarnings([profile('a', null)]);
    expect(w).toContainEqual({ profileId: 'a', level: 'high', message: expect.stringContaining('proxy') });
  });
  it('flags duplicated proxy host as medium', () => {
    const w = proxyWarnings([profile('a', '1.1.1.1'), profile('b', '1.1.1.1')]);
    expect(w.filter((x) => x.level === 'medium').map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
  it('flags duplicated locked exit IP as high risk', () => {
    const w = proxyWarnings([lockedProfile('a', '9.9.9.9'), lockedProfile('b', '9.9.9.9')]);
    expect(w.filter((x) => x.level === 'high').map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
  it('flags an exposed IPv6 as medium risk', () => {
    const p = profile('a', '1.1.1.1');
    p.lastProxyCheck = { checkedAt: 'now', ok: true, exitIp: '1.1.1.1', ipv6: '2001:db8::1' };
    const w = proxyWarnings([p]);
    expect(w).toContainEqual({ profileId: 'a', level: 'medium', message: expect.stringContaining('IPv6') });
  });
});
