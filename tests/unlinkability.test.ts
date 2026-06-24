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
    expect(w).toContainEqual({ profileId: 'a', level: 'high', kind: 'no-proxy', message: expect.stringContaining('proxy') });
  });
  it('flags duplicated proxy host as medium', () => {
    const w = proxyWarnings([profile('a', '1.1.1.1'), profile('b', '1.1.1.1')]);
    const dupHost = w.filter((x) => x.kind === 'dup-proxy-host');
    expect(dupHost.map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
  it('flags duplicated locked exit IP as high risk', () => {
    const w = proxyWarnings([lockedProfile('a', '9.9.9.9'), lockedProfile('b', '9.9.9.9')]);
    expect(w.filter((x) => x.kind === 'dup-exit-ip').map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
  it('flags an exposed IPv6 as medium risk', () => {
    const p = profile('a', '1.1.1.1');
    p.lastProxyCheck = { checkedAt: 'now', ok: true, exitIp: '1.1.1.1', ipv6: '2001:db8::1' };
    const w = proxyWarnings([p]);
    expect(w).toContainEqual({ profileId: 'a', level: 'medium', kind: 'ipv6-leak', message: expect.stringContaining('IPv6') });
  });

  // Two locked profiles on DIFFERENT exit IPs but the SAME provider (ASN/ISP/city,
  // different proxy hosts) => same-asn-geo, NOT dup-exit-ip. This is the real
  // "shows Trùng IP but IPs differ" case: distinct hosts/IPs, shared VIETSERVER ASN.
  it('flags same ASN/ISP/city with different exit IPs as same-asn-geo (not dup-exit-ip)', () => {
    const a = lockedProfile('a', '103.190.81.68', 'host-a');
    const b = lockedProfile('b', '103.170.255.95', 'host-b');
    const geo = { asn: '63737', country: 'Vietnam', city: 'Hanoi', isp: 'VIETSERVER' };
    a.lastProxyCheck = { checkedAt: 'now', ok: true, exitIp: '103.190.81.68', ...geo };
    b.lastProxyCheck = { checkedAt: 'now', ok: true, exitIp: '103.170.255.95', ...geo };
    const w = proxyWarnings([a, b]);
    expect(w.some((x) => x.kind === 'dup-exit-ip')).toBe(false);
    expect(w.some((x) => x.kind === 'dup-proxy-host')).toBe(false);
    expect(w.filter((x) => x.kind === 'same-asn-geo').map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
});
