import { binaryInfo } from 'cloakbrowser';
import type { Profile, ProxyCheckSnapshot, ResolvedIdentity, Fingerprint, ProxyConfig, IdentityDrift, IdentityPreflightResult } from './types';
import { IdentityDriftError, type ProxyTestResult } from './types';
import { ProxyTester } from './proxy-tester';

type VersionProvider = () => string;

const currentVersion: VersionProvider = () => binaryInfo().version;

/** Reuse a recent proxy check instead of launching a throwaway browser on
 *  every locked open. */
const PROXY_CHECK_TTL_MS = 10 * 60 * 1000;

function norm(v: string | null | undefined): string | null {
  return v == null || v === '' ? null : v;
}

/**
 * Treat two exit IPs as the same identity when they fall in the same IPv4 /24.
 * Sticky residential/ISP proxies often rotate the last octet within a subnet;
 * an exact-match block would wrongly flag those as a device change.
 */
export function sameIpScope(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const oa = a.split('.');
  const ob = b.split('.');
  if (oa.length === 4 && ob.length === 4) {
    return oa[0] === ob[0] && oa[1] === ob[1] && oa[2] === ob[2];
  }
  return false;
}

function proxyValue(p: ProxyConfig | null | undefined): string | null {
  if (!p) return null;
  return `${p.type}://${p.username ?? ''}:${p.password ?? ''}@${p.host}:${p.port}`;
}

export function toProxySnapshot(result: ProxyTestResult): ProxyCheckSnapshot {
  return {
    checkedAt: new Date().toISOString(),
    ok: result.ok,
    exitIp: result.exitIp ?? result.ip,
    ipv6: result.ipv6,
    country: result.country,
    city: result.city,
    timezone: result.timezone,
    asn: result.asn,
    isp: result.isp,
    latencyMs: result.latencyMs,
    error: result.error,
  };
}

export class IdentityService {
  constructor(
    private proxyTester: ProxyTester = new ProxyTester(),
    private versionProvider: VersionProvider = currentVersion,
  ) {}

  async checkLockedIdentity(profile: Profile): Promise<IdentityPreflightResult> {
    const drift: IdentityDrift[] = [];
    const locked = profile.resolvedIdentity;
    if (!profile.identityLocked) return { ok: true, drift };
    if (!locked) {
      drift.push({ field: 'resolvedIdentity', expected: 'present', actual: null });
      return { ok: false, drift };
    }

    this.compare(drift, 'cloakBrowserVersion', locked.cloakBrowserVersion, this.versionProvider());
    this.compare(drift, 'seed', String(locked.seed), String(profile.seed));
    this.compare(drift, 'platform', locked.platform, profile.platform);
    this.compare(drift, 'proxy', proxyValue(locked.proxy), proxyValue(profile.proxy));
    this.compare(drift, 'timezone', norm(locked.timezone), norm(profile.timezone));
    this.compare(drift, 'locale', norm(locked.locale), norm(profile.locale));

    let snapshot: ProxyCheckSnapshot | undefined;
    let fromCache = false;
    if (profile.proxy) {
      const cached = profile.lastProxyCheck;
      if (cached && cached.ok && cached.exitIp && this.isFresh(cached)) {
        snapshot = cached;
        fromCache = true;
      } else {
        snapshot = toProxySnapshot(await this.proxyTester.test(profile.proxy));
      }
      if (!snapshot.ok) {
        drift.push({ field: 'proxyCheck', expected: 'ok', actual: snapshot.error ?? 'failed' });
      } else if (!sameIpScope(locked.exitIp, snapshot.exitIp ?? null)) {
        drift.push({ field: 'exitIp', expected: locked.exitIp, actual: snapshot.exitIp ?? null });
      }
    } else {
      drift.push({ field: 'proxy', expected: proxyValue(locked.proxy), actual: null });
    }

    return { ok: drift.length === 0, drift, snapshot, fromCache };
  }

  private isFresh(snap: ProxyCheckSnapshot): boolean {
    const t = Date.parse(snap.checkedAt);
    return Number.isFinite(t) && Date.now() - t < PROXY_CHECK_TTL_MS;
  }

  /**
   * Patch that re-aligns a locked identity with the current environment, used
   * by "open and accept new IP". Keeps seed/platform/fingerprint/cookies; only
   * refreshes the binary version and proxy-derived fields.
   */
  reconcilePatch(snapshot?: ProxyCheckSnapshot): Partial<ResolvedIdentity> {
    const patch: Partial<ResolvedIdentity> = { cloakBrowserVersion: this.versionProvider() };
    if (snapshot?.ok && snapshot.exitIp) {
      patch.exitIp = snapshot.exitIp;
      patch.webrtcIp = snapshot.exitIp;
      if (snapshot.country) patch.exitCountry = snapshot.country;
      if (snapshot.timezone) patch.exitTimezone = snapshot.timezone;
    }
    return patch;
  }

  async checkProxy(proxy: ProxyConfig): Promise<ProxyCheckSnapshot> {
    return toProxySnapshot(await this.proxyTester.test(proxy));
  }

  async preflightLockedIdentity(profile: Profile): Promise<void> {
    const result = await this.checkLockedIdentity(profile);
    if (!result.ok) throw new IdentityDriftError(result.drift);
  }

  lockIdentityFromLaunch(
    profile: Profile,
    fingerprint: Fingerprint,
    visitorId: string | null,
    proxySnapshot: ProxyCheckSnapshot,
  ): ResolvedIdentity {
    if (!profile.proxy) throw new Error('Cannot lock identity without a proxy.');
    if (!proxySnapshot.ok || !proxySnapshot.exitIp) {
      throw new Error(proxySnapshot.error || 'Cannot lock identity without a resolved proxy exit IP.');
    }
    const timezone = profile.timezone ?? fingerprint.timezone ?? proxySnapshot.timezone ?? null;
    const locale = profile.locale ?? fingerprint.languages[0] ?? null;
    return {
      lockedAt: new Date().toISOString(),
      cloakBrowserVersion: this.versionProvider(),
      seed: profile.seed,
      platform: profile.platform,
      proxy: { ...profile.proxy },
      exitIp: proxySnapshot.exitIp,
      exitCountry: proxySnapshot.country,
      exitTimezone: proxySnapshot.timezone,
      locale,
      timezone,
      webrtcIp: proxySnapshot.exitIp,
      fingerprint,
      visitorId,
    };
  }

  private compare(drift: IdentityDrift[], field: string, expected: string | null, actual: string | null): void {
    if (expected !== actual) drift.push({ field, expected, actual });
  }
}
