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

export interface Profile {
  id: string;
  name: string;
  seed: number;
  proxy: ProxyConfig | null;
  geoip: boolean;
  timezone: string | null;
  locale: string | null;
  userDataDir: string;
  fingerprint: Fingerprint | null;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface CreateProfileInput {
  name: string;
  proxy?: ProxyConfig | null;
  geoip?: boolean;
  timezone?: string | null;
  locale?: string | null;
}

export type UpdateProfileInput = Partial<Omit<Profile, 'id' | 'seed' | 'userDataDir' | 'createdAt'>>;

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  country?: string;
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
