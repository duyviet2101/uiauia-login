import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig, FingerprintPlatform, Fingerprint } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export interface HardwareProfile {
  screenWidth: number;
  screenHeight: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
}

// Realistic screen resolutions per OS. The binary auto-generates a fixed value
// per platform (1920x1080 Win / 1440x900 Mac) that is IDENTICAL across seeds,
// so every profile on one machine shares it — a strong same-device link vector.
// We pick one deterministically from the seed to vary it per profile instead.
export const WINDOWS_SCREENS: ReadonlyArray<readonly [number, number]> = [
  [1920, 1080], [1536, 864], [1366, 768], [1600, 900],
  [1440, 900], [2560, 1440], [1680, 1050], [1280, 720],
];
export const MACOS_SCREENS: ReadonlyArray<readonly [number, number]> = [
  [1440, 900], [1512, 982], [1536, 960], [1680, 1050],
  [1728, 1117], [2056, 1329], [1280, 800], [2560, 1440],
];
const CORES: ReadonlyArray<number> = [4, 6, 8, 12, 16];
// navigator.deviceMemory is capped at 8 by the spec; 4 and 8 are the realistic
// desktop values.
const MEMORY: ReadonlyArray<number> = [4, 8];

// Deterministic 32-bit integer hash. Different salts decorrelate the picks so
// screen, cores, and memory vary independently rather than moving together.
function mix(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Derive a stable per-profile hardware identity from the seed. Because the seed
 * is fixed for the life of a profile, the result never changes between launches
 * — but differs across profiles, so two windows on the same physical machine no
 * longer share screen/cores/memory.
 */
export function deriveHardwareProfile(seed: number, platform: FingerprintPlatform): HardwareProfile {
  const screens = platform === 'macos' ? MACOS_SCREENS : WINDOWS_SCREENS;
  const [screenWidth, screenHeight] = screens[mix(seed, 0x9e3779b1) % screens.length];
  return {
    screenWidth,
    screenHeight,
    hardwareConcurrency: CORES[mix(seed, 0x85ebca77) % CORES.length],
    deviceMemory: MEMORY[mix(seed, 0xc2b2ae35) % MEMORY.length],
  };
}

/**
 * Hardware identity to launch with. A profile that already has a captured
 * fingerprint (locked, or probed on an earlier launch) reuses those exact
 * values so a warmed-up account never sees its device change; only a brand-new
 * profile derives fresh values from its seed.
 */
function hardwareProfileFor(p: Profile, frozen: Fingerprint | null, seed: number, platform: FingerprintPlatform): HardwareProfile {
  const fp = frozen ?? p.fingerprint;
  if (fp && fp.screen && fp.screen.width > 0) {
    return {
      screenWidth: fp.screen.width,
      screenHeight: fp.screen.height,
      hardwareConcurrency: fp.hardwareConcurrency,
      deviceMemory: fp.deviceMemory,
    };
  }
  return deriveHardwareProfile(seed, platform);
}

export function buildLaunchArgs(p: Profile): LaunchPersistentContextOptions {
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
  ];

  // Vary screen/cores/memory per profile. The binary leaves these constant
  // across seeds, so without explicit flags every profile on one machine shares
  // them. Frozen for warmed-up profiles, derived from the seed for new ones.
  const hw = hardwareProfileFor(p, locked?.fingerprint ?? null, seed, platform);
  args.push(
    `--fingerprint-screen-width=${hw.screenWidth}`,
    `--fingerprint-screen-height=${hw.screenHeight}`,
    `--fingerprint-hardware-concurrency=${hw.hardwareConcurrency}`,
  );
  if (hw.deviceMemory != null && hw.deviceMemory > 0) {
    args.push(`--fingerprint-device-memory=${hw.deviceMemory}`);
  }

  // geoip=true auto-injects --fingerprint-webrtc-ip; only add manually when proxy exists but geoip is off.
  if (locked) args.push(`--fingerprint-webrtc-ip=${locked.webrtcIp ?? locked.exitIp}`);
  else if (proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,
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
