import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
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
