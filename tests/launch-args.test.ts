import { describe, it, expect } from 'vitest';
import { toProxyUrl, buildLaunchArgs, deriveHardwareProfile, WINDOWS_SCREENS, MACOS_SCREENS } from '../src/main/launch-args';
import type { Profile, Fingerprint, ResolvedIdentity } from '../src/main/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'A', seed: 12345, platform: 'windows', proxy: null, geoip: true,
    timezone: null, locale: null, startUrl: null, userDataDir: '/data/p1',
    fingerprint: null, visitorId: null, diagnostics: null, identityLocked: false, resolvedIdentity: null, lastProxyCheck: null,
    createdAt: '', lastOpenedAt: null, ...over,
  };
}

/** Read the value of a `--flag=value` style arg (numeric flags only). */
function flag(args: string[] | undefined, name: string): string | undefined {
  const hit = (args ?? []).find((a) => a.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : undefined;
}

const baseFp: Fingerprint = {
  userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en-US'], screen: { width: 1920, height: 1080, colorDepth: 24 }, devicePixelRatio: 1,
  webglVendor: null, webglRenderer: null, timezone: 'UTC', webdriver: false, capturedAt: 'now',
};

/** A locked profile whose frozen identity carries the given fingerprint fields. */
function lockedWithFp(fp: Partial<Fingerprint>): Profile {
  const resolvedIdentity: ResolvedIdentity = {
    lockedAt: 'now', cloakBrowserVersion: '145', seed: 777, platform: 'windows',
    proxy: { type: 'http', host: 'h', port: 80 }, exitIp: '1.1.1.1', locale: null, timezone: null,
    webrtcIp: '1.1.1.1', fingerprint: { ...baseFp, ...fp }, visitorId: null,
  };
  return profile({ seed: 777, platform: 'windows', proxy: { type: 'http', host: 'h', port: 80 }, identityLocked: true, resolvedIdentity });
}

const hwSig = (o: { args?: string[] }) =>
  [
    flag(o.args, '--fingerprint-screen-width'),
    flag(o.args, '--fingerprint-screen-height'),
    flag(o.args, '--fingerprint-hardware-concurrency'),
    flag(o.args, '--fingerprint-device-memory'),
  ].join('/');

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

  // --- Per-profile hardware variation (multi-account on one physical device) ---

  it('unlocked: emits screen/cores/memory flags derived from the seed', () => {
    const seed = 4242042;
    const hw = deriveHardwareProfile(seed, 'windows');
    const o = buildLaunchArgs(profile({ seed, platform: 'windows', fingerprint: null }));
    expect(flag(o.args, '--fingerprint-screen-width')).toBe(String(hw.screenWidth));
    expect(flag(o.args, '--fingerprint-screen-height')).toBe(String(hw.screenHeight));
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe(String(hw.hardwareConcurrency));
    expect(flag(o.args, '--fingerprint-device-memory')).toBe(String(hw.deviceMemory));
  });

  it('unlocked: hardware varies across seeds so profiles are not linkable by device', () => {
    const seeds = [11, 2222, 30303, 444444, 5, 67890, 9090909, 13, 808080, 1234567, 24680, 99999999];
    const sigs = new Set(seeds.map((s) => hwSig(buildLaunchArgs(profile({ seed: s, fingerprint: null })))));
    expect(sigs.size).toBeGreaterThanOrEqual(4);
  });

  it('locked: hardware flags come from the frozen fingerprint, not re-derived', () => {
    const o = buildLaunchArgs(lockedWithFp({ screen: { width: 1600, height: 900, colorDepth: 24 }, hardwareConcurrency: 12, deviceMemory: 8 }));
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1600');
    expect(flag(o.args, '--fingerprint-screen-height')).toBe('900');
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe('12');
    expect(flag(o.args, '--fingerprint-device-memory')).toBe('8');
  });

  it('locked: null frozen deviceMemory => no device-memory flag (do not invent one)', () => {
    const o = buildLaunchArgs(lockedWithFp({ screen: { width: 1920, height: 1080, colorDepth: 24 }, hardwareConcurrency: 8, deviceMemory: null }));
    expect(flag(o.args, '--fingerprint-device-memory')).toBeUndefined();
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1920');
  });

  it('unlocked but already probed: reuse the probed fingerprint, do not change identity', () => {
    const probed: Fingerprint = { ...baseFp, screen: { width: 1280, height: 720, colorDepth: 24 }, hardwareConcurrency: 4, deviceMemory: 4 };
    const o = buildLaunchArgs(profile({ seed: 555, fingerprint: probed }));
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1280');
    expect(flag(o.args, '--fingerprint-screen-height')).toBe('720');
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe('4');
    expect(flag(o.args, '--fingerprint-device-memory')).toBe('4');
  });

  it('locked profile freezes geoip, locale/timezone, proxy, and WebRTC IP', () => {
    const locked = profile({
      seed: 999,
      platform: 'macos',
      proxy: { type: 'http', host: 'old', port: 80 },
      geoip: true,
      timezone: 'Asia/Tokyo',
      locale: 'ja-JP',
      identityLocked: true,
      resolvedIdentity: {
        lockedAt: 'now',
        cloakBrowserVersion: '146',
        seed: 111,
        platform: 'windows',
        proxy: { type: 'socks5', host: 'locked', port: 1080 },
        exitIp: '8.8.8.8',
        locale: 'en-US',
        timezone: 'America/New_York',
        webrtcIp: '8.8.8.8',
        fingerprint: {
          userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
          languages: ['en-US'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
          webglVendor: null, webglRenderer: null, timezone: 'America/New_York', webdriver: false, capturedAt: 'now',
        },
        visitorId: 'v',
      },
    });
    const o = buildLaunchArgs(locked);
    expect(o.geoip).toBe(false);
    expect(o.timezone).toBe('America/New_York');
    expect(o.locale).toBe('en-US');
    expect(o.proxy).toBe('socks5://locked:1080');
    expect(o.args).toContain('--fingerprint=111');
    expect(o.args).toContain('--fingerprint-platform=windows');
    expect(o.args).toContain('--fingerprint-webrtc-ip=8.8.8.8');
  });
});

describe('deriveHardwareProfile', () => {
  it('is deterministic for the same seed + platform', () => {
    expect(deriveHardwareProfile(12345, 'windows')).toEqual(deriveHardwareProfile(12345, 'windows'));
    expect(deriveHardwareProfile(12345, 'macos')).toEqual(deriveHardwareProfile(12345, 'macos'));
  });

  it('spreads hardware across seeds (not a constant)', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => ((i + 1) * 2654435761) % 90000000 + 10000);
    const screens = new Set(seeds.map((s) => { const h = deriveHardwareProfile(s, 'windows'); return `${h.screenWidth}x${h.screenHeight}`; }));
    const cores = new Set(seeds.map((s) => deriveHardwareProfile(s, 'windows').hardwareConcurrency));
    expect(screens.size).toBeGreaterThanOrEqual(3);
    expect(cores.size).toBeGreaterThanOrEqual(2);
  });

  it('draws screen resolution from the platform-appropriate pool', () => {
    for (const s of [1, 2, 3, 9999, 12345, 7777777]) {
      const w = deriveHardwareProfile(s, 'windows');
      const m = deriveHardwareProfile(s, 'macos');
      expect(WINDOWS_SCREENS).toContainEqual([w.screenWidth, w.screenHeight]);
      expect(MACOS_SCREENS).toContainEqual([m.screenWidth, m.screenHeight]);
    }
  });
});
