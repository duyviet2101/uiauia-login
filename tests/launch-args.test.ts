import { describe, it, expect } from 'vitest';
import { toProxyUrl, buildLaunchArgs } from '../src/main/launch-args';
import type { Profile } from '../src/main/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'A', seed: 12345, platform: 'windows', proxy: null, geoip: true,
    timezone: null, locale: null, startUrl: null, userDataDir: '/data/p1',
    fingerprint: null, visitorId: null, createdAt: '', lastOpenedAt: null, ...over,
  };
}

describe('toProxyUrl', () => {
  it('http without auth', () => {
    expect(toProxyUrl({ type: 'http', host: '1.2.3.4', port: 8080 }))
      .toBe('http://1.2.3.4:8080');
  });
  it('socks5 with auth, url-encodes credentials', () => {
    expect(toProxyUrl({ type: 'socks5', host: 'h', port: 1080, username: 'u@x', password: 'p:y' }))
      .toBe('socks5://u%40x:p%3Ay@h:1080');
  });
});

describe('buildLaunchArgs', () => {
  it('always headed with fingerprint seed', () => {
    const o = buildLaunchArgs(profile());
    expect(o.headless).toBe(false);
    expect(o.userDataDir).toBe('/data/p1');
    expect(o.args).toContain('--fingerprint=12345');
  });
  it('forces windows platform and drops default stealth args (no --no-sandbox)', () => {
    const o = buildLaunchArgs(profile());
    expect(o.args).toContain('--fingerprint-platform=windows');
    expect(o.stealthArgs).toBe(false);
    expect(o.args).not.toContain('--no-sandbox');
  });
  it('no proxy => no geoip, no webrtc flag', () => {
    const o = buildLaunchArgs(profile({ proxy: null }));
    expect(o.proxy).toBeUndefined();
    expect(o.geoip).toBe(false);
    expect(o.args).not.toContain('--fingerprint-webrtc-ip=auto');
  });
  it('proxy + geoip on => geoip true, no manual webrtc flag (geoip auto-injects)', () => {
    const o = buildLaunchArgs(profile({ proxy: { type: 'http', host: 'h', port: 80 }, geoip: true }));
    expect(o.geoip).toBe(true);
    expect(o.args).not.toContain('--fingerprint-webrtc-ip=auto');
  });
  it('proxy + geoip off => add manual webrtc flag', () => {
    const o = buildLaunchArgs(profile({ proxy: { type: 'http', host: 'h', port: 80 }, geoip: false }));
    expect(o.geoip).toBe(false);
    expect(o.args).toContain('--fingerprint-webrtc-ip=auto');
  });
  it('manual timezone/locale override pass through', () => {
    const o = buildLaunchArgs(profile({ timezone: 'Asia/Tokyo', locale: 'ja-JP' }));
    expect(o.timezone).toBe('Asia/Tokyo');
    expect(o.locale).toBe('ja-JP');
  });
});
