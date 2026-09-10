export interface ProxyConfig {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface Fingerprint {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  languages: string[];
  screen: { width: number; height: number; colorDepth: number };
  devicePixelRatio: number;
  webglVendor: string | null;
  webglRenderer: string | null;
  timezone: string;
  webdriver: boolean;
  capturedAt: string;
}

export interface FontProbe {
  family: string;
  available: boolean;
}

export interface FingerprintDiagnostics {
  capturedAt: string;
  canvasHash: string;
  canvasWinding: boolean | null;
  audioHash: string | null;
  fontHash: string;
  fonts: FontProbe[];
  fontsAvailable: number;
  fontsTotal: number;
  /** Detected dictionary fonts outside the stock Windows baseline — user-installed
   *  fonts that leak identically into every profile (a cross-profile linkage). */
  nonStandardFonts: string[];
  warnings: string[];
}

export type FingerprintPlatform = 'windows' | 'macos';

export interface WindowCustomization {
  enabled: boolean;
  /** Stable manager-assigned number shown in the native Windows title/icon. */
  number: number;
  /** Normalized #RRGGBB icon background color. */
  color: string;
}

export interface WindowCustomizationInput {
  enabled?: boolean;
  /** Null/undefined asks the store to choose the deterministic palette color. */
  color?: string | null;
}

export interface ProxyCheckSnapshot {
  checkedAt: string;
  ok: boolean;
  exitIp?: string;
  /** Best-effort: an IPv6 reachable through the browser (possible leak if the
   *  proxy only covers IPv4). Undefined = no IPv6 seen = safe. */
  ipv6?: string;
  country?: string;
  city?: string;
  timezone?: string;
  asn?: string;
  isp?: string;
  latencyMs?: number;
  error?: string;
}

export interface ProxyPrecheckResult {
  /** false when the profile has no proxy (nothing tested — caller opens directly). */
  tested: boolean;
  ok: boolean;
  error?: string;
  snapshot?: ProxyCheckSnapshot;
}

export interface ResolvedIdentity {
  lockedAt: string;
  /** Engine version this identity was locked to. Only ever changed by an
   *  explicit "accept engine" action — never as a side effect of accepting a
   *  new IP (see IdentityService.reconcilePatch / enginePatch). */
  cloakBrowserVersion: string;
  /** When the user explicitly accepted a new engine version, if ever. */
  engineAcceptedAt?: string;
  seed: number;
  platform: FingerprintPlatform;
  proxy: ProxyConfig;
  exitIp: string;
  exitCountry?: string;
  exitTimezone?: string;
  locale: string | null;
  timezone: string | null;
  webrtcIp: string | null;
  fingerprint: Fingerprint;
  visitorId: string | null;
}

/**
 * The fingerprint a profile is SUPPOSED to have — accepted once, then only ever
 * changed by an explicit user action.
 *
 * Kept apart from the latest observation on purpose. Storing one "current
 * fingerprint" made drift invisible: whatever the browser reported became the
 * record of what it was supposed to report, so a change could never disagree
 * with anything.
 */
export interface FingerprintBaseline {
  fingerprint: Fingerprint;
  acceptedAt: string;
  /**
   * Engine that produced it. A different engine is an ordinary explanation for a
   * different fingerprint, so a comparison that ignores this reports an upgrade
   * as if it were tampering.
   */
  engineVersion: string;
  /** Profile schema version at acceptance — a later shape change stays visible. */
  schemaVersion: number;
  /** How the baseline came to be accepted. */
  source: 'first-launch' | 'identity-lock' | 'user-accepted';
}

/** What the browser actually reported the last time it was opened. Rewritten on
 *  every launch; never promoted to the baseline on its own. */
export interface FingerprintObservation {
  fingerprint: Fingerprint;
  observedAt: string;
  engineVersion: string;
}

/**
 * A reading that was attempted and failed.
 *
 * Recorded rather than inferred. "No observation" has two very different causes
 * — the app never looked, or it looked and got nothing — and they cannot be told
 * apart from absence alone. Guessing produced a real wrong answer: a profile
 * migrated from an old store reported `check-failed` when nothing had failed.
 */
export interface FingerprintObservationError {
  at: string;
  message: string;
}

export interface Profile {
  id: string;
  name: string;
  seed: number;
  platform: FingerprintPlatform;
  proxy: ProxyConfig | null;
  geoip: boolean;
  timezone: string | null;
  locale: string | null;
  startUrl: string | null;
  userDataDir: string;
  /** Accepted baseline. Null until the first launch has produced one. */
  baseline: FingerprintBaseline | null;
  /** Most recent launch observation. Null until the profile has been opened. */
  lastObservation: FingerprintObservation | null;
  /** Most recent FAILED reading. Cleared by a successful one. */
  lastObservationError: FingerprintObservationError | null;
  visitorId: string | null;
  /** Last FULL diagnostics run (the heavy probe), which is a third thing again:
   *  it is not taken on every launch, so it can legitimately be older than both. */
  diagnostics: FingerprintDiagnostics | null;
  identityLocked: boolean;
  resolvedIdentity: ResolvedIdentity | null;
  lastProxyCheck: ProxyCheckSnapshot | null;
  /** Block the geolocation permission via seeded Chrome Preferences (default on). */
  blockGeolocation: boolean;
  /** Send the navigator.doNotTrack / DNT header via seeded Chrome Preferences (default off). */
  doNotTrack: boolean;
  windowCustomization: WindowCustomization;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface CreateProfileInput {
  name: string;
  platform?: FingerprintPlatform;
  proxy?: ProxyConfig | null;
  geoip?: boolean;
  timezone?: string | null;
  locale?: string | null;
  startUrl?: string | null;
  blockGeolocation?: boolean;
  doNotTrack?: boolean;
  windowCustomization?: WindowCustomizationInput;
}

/**
 * `baseline` and `lastObservation` are omitted on purpose: they have dedicated
 * mutations (`acceptBaseline`, `recordObservation`) that enforce who may write
 * them. A generic patch would let any caller quietly promote an observation to
 * a baseline, which is exactly the confusion this split exists to prevent.
 */
export type UpdateProfileInput = Partial<
  Omit<Profile, 'id' | 'seed' | 'userDataDir' | 'createdAt' | 'windowCustomization' | 'baseline' | 'lastObservation' | 'lastObservationError'>
> & {
  windowCustomization?: WindowCustomizationInput;
};

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  exitIp?: string;
  /** Best-effort IPv6 echoed back through the proxied browser (possible leak). */
  ipv6?: string;
  country?: string;
  city?: string;
  timezone?: string;
  asn?: string;
  isp?: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Four states, and no fifth. There is deliberately no numeric "safety score":
 * a made-up number invites the user to act on a precision the data does not
 * have. Each state says what was compared and what was found, nothing more.
 */
export type ProfileHealthState =
  | 'stable'        // the last observation matches the accepted baseline
  | 'changed'       // it does not — `changes` says which fields
  | 'insufficient'  // nothing to compare yet (new profile, or never observed)
  | 'check-failed'; // the profile was opened but no reading came back

export interface FingerprintFieldChange {
  field: string;
  baseline: string | null;
  observed: string | null;
}

export interface ProfileHealth {
  state: ProfileHealthState;
  /** Plain-language reason. Always present, including for `stable`. */
  reason: string;
  changes: FingerprintFieldChange[];
  /**
   * The engine differs between baseline and observation. An engine upgrade is an
   * ordinary explanation for a changed fingerprint, so it is reported next to
   * the changes rather than folded into them.
   */
  engineChanged: boolean;
  baselineEngine: string | null;
  observedEngine: string | null;
  acceptedAt: string | null;
  observedAt: string | null;
  /** When the last FULL diagnostics ran — a third clock, often older than both. */
  diagnosticsAt: string | null;
}

export interface ProfileRuntime extends Profile {
  running: boolean;
  /** Derived in the main process so the renderer never re-implements the
   *  comparison (and never disagrees with it). */
  health: ProfileHealth;
}

export type ProxyWarningKind =
  | 'no-proxy'        // profile has no proxy (shares host IP)
  | 'ip-changed'      // current exit IP differs from the locked identity
  | 'ipv6-present'    // an IPv6 was reachable — origin unknown, NOT proof of a leak
  | 'ipv6-shared'     // the same IPv6 behind two different proxies => host-originated
  | 'dup-exit-ip'     // two locked profiles share the SAME exit IP
  | 'same-asn-geo'    // two locked profiles share ASN/ISP/city (context, not linkage)
  | 'dup-proxy-host'; // two profiles point at the same proxy host:port

/**
 * Severity is about what the observation PROVES, not how alarming it sounds.
 *
 *  - `high`   — observed linkage or an observed loss of isolation.
 *  - `medium` — a configuration that will produce linkage if left alone.
 *  - `low`    — context worth seeing that is NOT evidence of linkage on its own.
 *
 * The `low` level exists because two findings used to be reported as risks
 * without the data to support that claim (see unlinkability.ts).
 */
export type ProxyWarningLevel = 'high' | 'medium' | 'low';

export interface ProxyWarning {
  profileId: string;
  level: ProxyWarningLevel;
  /** Machine-readable cause, so the UI can label it accurately (not by level). */
  kind: ProxyWarningKind;
  message: string;
}

export interface IdentityDrift {
  field: string;
  expected: string | null;
  actual: string | null;
}

export class IdentityDriftError extends Error {
  readonly code = 'IDENTITY_DRIFT_BLOCKED';

  constructor(public readonly drift: IdentityDrift[]) {
    super(`Identity drift blocked: ${drift.map((d) => d.field).join(', ')}`);
  }
}

/**
 * Thrown when a launch is stopped BEFORE Chromium starts, because the profile
 * would restore its previous session over a proxy that did not answer.
 *
 * Deliberately distinct from IdentityDriftError. Drift is a comparison the user
 * can resolve by accepting the new value; this is the absence of a verified
 * exit, and no acceptance makes replaying the session over it safe. The UI must
 * not offer an "open anyway" here.
 */
export class ProxyPreflightError extends Error {
  readonly code = 'PROXY_PREFLIGHT_BLOCKED';

  constructor(
    public readonly reason: string,
    public readonly snapshot?: ProxyCheckSnapshot,
  ) {
    super(`Proxy preflight failed: ${reason}`);
  }
}

export interface LaunchResult {
  launched: true;
  lockedNow: boolean;
  warnings: ProxyWarning[];
}

export interface IdentityPreflightResult {
  ok: boolean;
  drift: IdentityDrift[];
  /** Proxy check used for the exit-IP comparison, if one ran. */
  snapshot?: ProxyCheckSnapshot;
  /** True when `snapshot` was reused from cache rather than freshly tested. */
  fromCache?: boolean;
}

export type InitPhase =
  | 'starting'
  | 'preparing-binary'
  | 'starting-services'
  | 'ready'
  | 'error';

export interface InitState {
  phase: InitPhase;
  message: string;
}


export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  platform: 'win32' | 'darwin' | 'other';
  current: string;
  latest: string | null;
  percent?: number;
  canAutoInstall: boolean;
  error?: string;
}

export interface UpdaterAdapter {
  /** Win = true (cài & relaunch); Mac = false (chỉ mở installer). */
  readonly canAutoInstall: boolean;
  check(current: string): Promise<{ available: boolean; latest: string | null }>;
  start(onProgress: (percent: number) => void): Promise<{ ready: boolean; artifactPath?: string }>;
  apply(): Promise<void>;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
}
