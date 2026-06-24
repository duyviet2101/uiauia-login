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
  cloakBrowserVersion: string;
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
  fingerprint: Fingerprint | null;
  visitorId: string | null;
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

export type UpdateProfileInput = Partial<
  Omit<Profile, 'id' | 'seed' | 'userDataDir' | 'createdAt' | 'windowCustomization'>
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

export interface ProfileRuntime extends Profile {
  running: boolean;
}

export type ProxyWarningKind =
  | 'no-proxy'        // profile has no proxy (shares host IP)
  | 'ip-changed'      // current exit IP differs from the locked identity
  | 'ipv6-leak'       // an IPv6 leaked past an IPv4-only proxy
  | 'dup-exit-ip'     // two locked profiles share the SAME exit IP
  | 'same-asn-geo'    // two locked profiles share ASN/ISP/city (diff IP, weaker link)
  | 'dup-proxy-host'; // two profiles point at the same proxy host:port

export interface ProxyWarning {
  profileId: string;
  level: 'high' | 'medium';
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
