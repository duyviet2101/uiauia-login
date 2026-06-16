import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export function buildLaunchArgs(p: Profile): LaunchPersistentContextOptions {
  const args = [`--fingerprint=${p.seed}`];
  // geoip=true auto-injects --fingerprint-webrtc-ip; only add manually when proxy exists but geoip is off.
  if (p.proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,
    proxy: p.proxy ? toProxyUrl(p.proxy) : undefined,
    geoip: p.proxy ? p.geoip : false,
    timezone: p.timezone ?? undefined,
    locale: p.locale ?? undefined,
    args,
  };
}
