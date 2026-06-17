import { describe, it, expect } from 'vitest';
import { findProxyConflicts, proxyWarnings } from '../src/main/unlinkability';
import type { Profile } from '../src/main/types';

function profile(id: string, host: string | null, port = 8080): Profile {
  return {
    id, name: id, seed: 1, platform: 'windows', geoip: true, timezone: null, locale: null,
    startUrl: null, userDataDir: '/d/' + id, fingerprint: null, visitorId: null,
    createdAt: '', lastOpenedAt: null,
    proxy: host ? { type: 'http', host, port } : null,
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
});
