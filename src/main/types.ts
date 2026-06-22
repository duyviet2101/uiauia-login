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

export type FingerprintPlatform = 'windows' | 'macos';

export interface ProxyCheckSnapshot {
  checkedAt: string;
  ok: boolean;
  exitIp?: string;
  country?: string;
  city?: string;
  timezone?: string;
  asn?: string;
  isp?: string;
  latencyMs?: number;
  error?: string;
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
  identityLocked: boolean;
  resolvedIdentity: ResolvedIdentity | null;
  lastProxyCheck: ProxyCheckSnapshot | null;
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
}

export type UpdateProfileInput = Partial<Omit<Profile, 'id' | 'seed' | 'userDataDir' | 'createdAt'>>;

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  exitIp?: string;
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

export interface ProxyWarning {
  profileId: string;
  level: 'high' | 'medium';
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

export interface UpdateInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  url: string | null;
  error?: string;
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
