import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig, Fingerprint } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export interface Display {
  width: number;
  height: number;
}

/** Fallback when the real display can't be read (e.g. unit tests). */
const DEFAULT_DISPLAY: Display = { width: 1920, height: 1080 };

export interface HardwareProfile {
  hardwareConcurrency: number;
  deviceMemory: number | null;
}

const CORES: ReadonlyArray<number> = [4, 6, 8, 12, 16];
// navigator.deviceMemory is capped at 8 by the spec; 4 and 8 are the realistic
// desktop values.
const MEMORY: ReadonlyArray<number> = [4, 8];

// Deterministic 32-bit integer hash. Different salts decorrelate the picks so
// cores and memory vary independently rather than moving together.
function mix(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Derive a stable per-profile CPU/RAM identity from the seed. Fixed for the life
 * of a profile (stable across launches) but differs across profiles, so two
 * windows on one machine don't share cores/memory.
 *
 * NOTE: screen resolution is deliberately NOT derived here — it must match the
 * real monitor (see buildLaunchArgs), otherwise the binary's window-position
 * patch fights fullscreen and FingerprintJS flags a "Virtual machine".
 */
export function deriveHardwareProfile(seed: number): HardwareProfile {
  return {
    hardwareConcurrency: CORES[mix(seed, 0x85ebca77) % CORES.length],
    deviceMemory: MEMORY[mix(seed, 0xc2b2ae35) % MEMORY.length],
  };
}

/**
 * CPU/RAM to launch with. A profile that already has a captured fingerprint
 * (locked, or probed on an earlier launch) reuses those exact values so a
 * warmed-up account never sees its device change; only a brand-new profile
 * derives fresh values from its seed.
 */
function hardwareProfileFor(p: Profile, frozen: Fingerprint | null, seed: number): HardwareProfile {
  const fp = frozen ?? p.fingerprint;
  if (fp && fp.hardwareConcurrency > 0) {
    return { hardwareConcurrency: fp.hardwareConcurrency, deviceMemory: fp.deviceMemory };
  }
  return deriveHardwareProfile(seed);
}

export function buildLaunchArgs(p: Profile, display: Display = DEFAULT_DISPLAY): LaunchPersistentContextOptions {
  const locked = p.identityLocked ? p.resolvedIdentity : null;
  if (p.identityLocked && !locked) throw new Error('Profile identity is locked but resolved identity is missing.');
  const seed = locked?.seed ?? p.seed;
  const platform = locked?.platform ?? p.platform;
  const proxy = locked?.proxy ?? p.proxy;
  const timezone = locked ? locked.timezone : p.timezone;
  const locale = locked ? locked.locale : p.locale;
  const args = [
    `--fingerprint=${seed}`,
    // Per-profile spoofed OS. 'windows' makes the binary derive a varied UA/GPU
    // from the seed and hides the host machine; 'macos' presents as a native
    // Mac (UA/GPU closer to the real host — less variation across profiles).
    `--fingerprint-platform=${platform === 'macos' ? 'macos' : 'windows'}`,
    // Headed Chromium blocks WebGL on software GPUs without this.
    '--ignore-gpu-blocklist',
    // Screen MUST equal the real monitor. The binary's window-position patch
    // keeps the window consistent with the spoofed screen, so a mismatch makes
    // fullscreen pop back / drift off-screen on relayout (e.g. opening a tab)
    // and trips FingerprintJS "Virtual machine" (screen != viewport).
    `--fingerprint-screen-width=${display.width}`,
    `--fingerprint-screen-height=${display.height}`,
    // Let Chromium/Windows own the native window geometry. Combined with a
    // null Playwright viewport, this avoids re-applying device metrics whenever
    // a new tab is created (which can unmaximize/reposition headed windows).
    '--start-maximized',
  ];

  // Vary CPU/RAM per profile (no window-geometry coupling). Frozen for warmed-up
  // profiles, derived from the seed for new ones.
  const hw = hardwareProfileFor(p, locked?.fingerprint ?? null, seed);
  args.push(`--fingerprint-hardware-concurrency=${hw.hardwareConcurrency}`);
  if (hw.deviceMemory != null && hw.deviceMemory > 0) {
    args.push(`--fingerprint-device-memory=${hw.deviceMemory}`);
  }

  // geoip=true auto-injects --fingerprint-webrtc-ip; only add manually when proxy exists but geoip is off.
  if (locked) args.push(`--fingerprint-webrtc-ip=${locked.webrtcIp ?? locked.exitIp}`);
  else if (proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,
    // A fixed viewport enables Playwright's device-metrics override. On the
    // patched Windows browser that override can fight fullscreen/maximize on
    // each new tab, moving the native window. null keeps sizing fully native.
    viewport: null,
    // Drop cloakbrowser's default stealth args (which include --no-sandbox,
    // unneeded on desktop and triggers Chrome's "unsupported flag" warning).
    // The 58 C++ stealth patches live in the binary and stay active regardless.
    stealthArgs: false,
    proxy: proxy ? toProxyUrl(proxy) : undefined,
    geoip: locked ? false : proxy ? p.geoip : false,
    timezone: timezone ?? undefined,
    locale: locale ?? undefined,
    args,
  };
}
