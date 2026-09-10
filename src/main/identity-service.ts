import { binaryInfo } from 'cloakbrowser';
import type { Profile, ProxyCheckSnapshot, ResolvedIdentity, Fingerprint, ProxyConfig, IdentityDrift, IdentityPreflightResult } from './types';
import { IdentityDriftError, type ProxyTestResult } from './types';
import { ProxyTester } from './proxy-tester';

type VersionProvider = () => string;

const currentVersion: VersionProvider = () => binaryInfo().version;

/**
 * How long a proxy check may stand in for a fresh one.
 *
 * This is a HANDOFF window, not a cache. Its only job is to stop the
 * precheck -> confirm -> launch sequence of a single user action from testing
 * the same proxy twice in a row, which costs a throwaway browser each time.
 *
 * It used to be 10 minutes, which turned it into a cache: a rotating
 * residential proxy can hand out a different exit IP several times inside that
 * window, so a launch could be admitted against an exit that no longer existed
 * — and admitted is not a soft state here, because the launch immediately
 * replays the profile's previous session (see BrowserManager.preflight).
 */
const PROXY_CHECK_TTL_MS = 90 * 1000;

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
      if (this.isSnapshotUsable(cached)) {
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

  /**
   * True when `snap` is recent enough to stand in for a fresh test. Public so
   * the launch path applies exactly the same rule the locked check does — two
   * different freshness definitions would be a hole waiting to be found.
   */
  isSnapshotFresh(snap: ProxyCheckSnapshot): boolean {
    const t = Date.parse(snap.checkedAt);
    return Number.isFinite(t) && Date.now() - t < PROXY_CHECK_TTL_MS;
  }

  /** A snapshot that may be reused as evidence: fresh, successful, and with an
   *  exit IP actually resolved. Anything else must be re-tested. */
  isSnapshotUsable(snap: ProxyCheckSnapshot | null | undefined): snap is ProxyCheckSnapshot {
    return !!snap && snap.ok && !!snap.exitIp && this.isSnapshotFresh(snap);
  }

  /**
   * Patch for "open and accept the new IP": proxy-derived fields ONLY.
   *
   * It deliberately does NOT touch `cloakBrowserVersion`. Accepting a rotated
   * proxy IP and accepting a new browser engine are different decisions with
   * different risk — a browser upgrade changes the fingerprint a site sees,
   * while an IP rotation does not. Folding the engine version in here meant one
   * click silently re-baselined the identity onto whatever binary happened to be
   * installed. Use `enginePatch()` for that, only when the user asks for it.
   */
  reconcilePatch(snapshot?: ProxyCheckSnapshot): Partial<ResolvedIdentity> {
    const patch: Partial<ResolvedIdentity> = {};
    if (snapshot?.ok && snapshot.exitIp) {
      patch.exitIp = snapshot.exitIp;
      patch.webrtcIp = snapshot.exitIp;
      if (snapshot.country) patch.exitCountry = snapshot.country;
      if (snapshot.timezone) patch.exitTimezone = snapshot.timezone;
    }
    return patch;
  }

  /** The engine version currently installed — what a locked identity would be
   *  re-baselined to if the user accepts an engine change. */
  currentEngineVersion(): string {
    return this.versionProvider();
  }

  /** Explicit, user-driven acceptance of a new engine version. Separate from
   *  `reconcilePatch` on purpose; never applied automatically. */
  enginePatch(): Partial<ResolvedIdentity> {
    return { cloakBrowserVersion: this.versionProvider(), engineAcceptedAt: new Date().toISOString() };
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
