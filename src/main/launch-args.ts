import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export function buildLaunchArgs(p: Profile): LaunchPersistentContextOptions {
  const args = [
    `--fingerprint=${p.seed}`,
    // Per-profile spoofed OS. 'windows' makes the binary derive a varied UA/GPU
    // from the seed and hides the host machine; 'macos' presents as a native
    // Mac (UA/GPU closer to the real host — less variation across profiles).
    `--fingerprint-platform=${p.platform === 'macos' ? 'macos' : 'windows'}`,
    // Headed Chromium blocks WebGL on software GPUs without this.
    '--ignore-gpu-blocklist',
  ];
  // geoip=true auto-injects --fingerprint-webrtc-ip; only add manually when proxy exists but geoip is off.
  if (p.proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,
    // Drop cloakbrowser's default stealth args (which include --no-sandbox,
    // unneeded on desktop and triggers Chrome's "unsupported flag" warning).
    // The 58 C++ stealth patches live in the binary and stay active regardless.
    stealthArgs: false,
    proxy: p.proxy ? toProxyUrl(p.proxy) : undefined,
    geoip: p.proxy ? p.geoip : false,
    timezone: p.timezone ?? undefined,
    locale: p.locale ?? undefined,
    args,
  };
}
