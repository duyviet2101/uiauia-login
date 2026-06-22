import { describe, it, expect } from 'vitest';
import { toProxyUrl, buildLaunchArgs, deriveHardwareProfile } from '../src/main/launch-args';
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

/** Signature of the per-profile (seed-varied) hardware: cores + memory only.
 *  Screen is NOT here — it follows the real display, not the seed. */
const hwSig = (o: { args?: string[] }) =>
  [
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

  // --- Screen MUST match the real display (not the seed). A spoofed screen that
  // differs from the real monitor makes the binary's window-position patch fight
  // fullscreen (window drifts off-screen) and trips FingerprintJS "Virtual machine".

  it('screen + viewport come from the real display, not the seed', () => {
    const display = { width: 1366, height: 768 };
    const o = buildLaunchArgs(profile({ seed: 4242042, fingerprint: null }), display);
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1366');
    expect(flag(o.args, '--fingerprint-screen-height')).toBe('768');
    expect(o.viewport).toEqual({ width: 1366, height: 768 - 133 });
  });

  it('screen is constant across seeds for the same display', () => {
    const display = { width: 2560, height: 1440 };
    const a = buildLaunchArgs(profile({ seed: 111, fingerprint: null }), display);
    const b = buildLaunchArgs(profile({ seed: 999999, fingerprint: null }), display);
    expect(flag(a.args, '--fingerprint-screen-width')).toBe('2560');
    expect(flag(b.args, '--fingerprint-screen-width')).toBe(flag(a.args, '--fingerprint-screen-width'));
  });

  it('defaults to 1920x1080 when no display is provided', () => {
    const o = buildLaunchArgs(profile());
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1920');
    expect(flag(o.args, '--fingerprint-screen-height')).toBe('1080');
    expect(o.viewport).toEqual({ width: 1920, height: 947 });
  });

  // --- cores/memory DO still vary per profile (no window-geometry coupling) ---

  it('unlocked: emits cores/memory flags derived from the seed', () => {
    const seed = 4242042;
    const hw = deriveHardwareProfile(seed);
    const o = buildLaunchArgs(profile({ seed, fingerprint: null }));
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe(String(hw.hardwareConcurrency));
    expect(flag(o.args, '--fingerprint-device-memory')).toBe(String(hw.deviceMemory));
  });

  it('unlocked: cores/memory vary across seeds so profiles are not linkable by device', () => {
    const seeds = [11, 2222, 30303, 444444, 5, 67890, 9090909, 13, 808080, 1234567, 24680, 99999999];
    const sigs = new Set(seeds.map((s) => hwSig(buildLaunchArgs(profile({ seed: s, fingerprint: null })))));
    expect(sigs.size).toBeGreaterThanOrEqual(3);
  });

  it('locked: cores/memory from frozen fingerprint; screen from the real display', () => {
    const o = buildLaunchArgs(
      lockedWithFp({ screen: { width: 1600, height: 900, colorDepth: 24 }, hardwareConcurrency: 12, deviceMemory: 8 }),
      { width: 1920, height: 1080 },
    );
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe('12');
    expect(flag(o.args, '--fingerprint-device-memory')).toBe('8');
    // Screen follows the machine's monitor (1920), NOT the frozen 1600.
    expect(flag(o.args, '--fingerprint-screen-width')).toBe('1920');
  });

  it('locked: null frozen deviceMemory => no device-memory flag (do not invent one)', () => {
    const o = buildLaunchArgs(lockedWithFp({ hardwareConcurrency: 8, deviceMemory: null }));
    expect(flag(o.args, '--fingerprint-device-memory')).toBeUndefined();
    expect(flag(o.args, '--fingerprint-hardware-concurrency')).toBe('8');
  });

  it('unlocked but already probed: reuse the probed cores/memory, do not change identity', () => {
    const probed: Fingerprint = { ...baseFp, hardwareConcurrency: 4, deviceMemory: 4 };
    const o = buildLaunchArgs(profile({ seed: 555, fingerprint: probed }));
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
  it('is deterministic for the same seed', () => {
    expect(deriveHardwareProfile(12345)).toEqual(deriveHardwareProfile(12345));
  });

  it('spreads cores/memory across seeds (not a constant)', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => ((i + 1) * 2654435761) % 90000000 + 10000);
    const sigs = new Set(seeds.map((s) => {
      const h = deriveHardwareProfile(s);
      return `${h.hardwareConcurrency}/${h.deviceMemory}`;
    }));
    expect(sigs.size).toBeGreaterThanOrEqual(3);
  });
});
