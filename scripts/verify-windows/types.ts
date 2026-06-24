// Data shapes for the Windows anti-detect verification harness.
//
// A ProfileObservation is the full fingerprint vector set captured from one
// throwaway profile's browser window. The pure analyses (collisions,
// consistency) consume these; the probe produces them.

export interface UaBrand {
  brand: string;
  version: string;
}

/** navigator.userAgentData + getHighEntropyValues, null when the API is absent. */
export interface UaClientHints {
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  model: string | null;
  uaFullVersion: string | null;
  mobile: boolean | null;
  brands: UaBrand[];
  fullVersionList: UaBrand[];
}

export interface ScreenMetrics {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
}

/** Selected WebGL getParameter values that vary per fingerprint seed. */
export interface WebglParams {
  maxTextureSize: number | null;
  maxRenderbufferSize: number | null;
  maxVertexAttribs: number | null;
  maxViewportDims: string | null;
  aliasedLineWidthRange: string | null;
  shadingLanguageVersion: string | null;
  glVersion: string | null;
}

/** The richer vector set the in-page probe returns (browser-side, no profile metadata). */
export interface RawObservation {
  userAgent: string;
  uaClientHints: UaClientHints | null;
  platform: string;
  languages: string[];
  webdriver: boolean;
  maxTouchPoints: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  screen: ScreenMetrics;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  timezone: string;
  timezoneOffset: number;
  webglVendor: string | null;
  webglRenderer: string | null;
  webglParams: WebglParams;
  canvasHash: string;
  canvasWinding: boolean | null;
  audioHash: string | null;
  fontHash: string;
  fonts: { family: string; available: boolean }[];
  clientRectsHash: string;
}

/** Best-effort headline numbers scraped from an external detector site. */
export interface ExternalSiteResult {
  site: string;
  url: string;
  status: 'ok' | 'unavailable';
  /** creepjs lie count, iphey verdict, etc. — site-specific, free-form. */
  headline?: Record<string, string | number | null>;
  error?: string;
}

/** One profile's full observation = profile metadata + raw probe + external. */
export interface ProfileObservation extends RawObservation {
  profileId: string;
  profileName: string;
  seed: number;
  /** false when the profile failed to launch / probe; analyses skip it. */
  ok: boolean;
  error?: string;
  external?: ExternalSiteResult[];
  capturedAt: string;
}

export type CollisionSeverity = 'HIGH' | 'CONTEXT';

export interface CollisionGroup {
  /** The shared value (stringified) that ≥2 profiles have in common. */
  value: string;
  profileIds: string[];
}

export interface CollisionRow {
  vector: string;
  severity: CollisionSeverity;
  groups: CollisionGroup[];
}

export type RuleStatus = 'pass' | 'warn' | 'fail';

export interface RuleResult {
  rule: string;
  status: RuleStatus;
  message: string;
}

/** A failed-to-launch observation: ok=false plus enough to render an error row. */
export function errorObservation(
  profileId: string,
  profileName: string,
  seed: number,
  error: string,
): ProfileObservation {
  return {
    profileId,
    profileName,
    seed,
    ok: false,
    error,
    userAgent: '',
    uaClientHints: null,
    platform: '',
    languages: [],
    webdriver: false,
    maxTouchPoints: 0,
    hardwareConcurrency: 0,
    deviceMemory: null,
    screen: { width: 0, height: 0, availWidth: 0, availHeight: 0, colorDepth: 0, pixelDepth: 0 },
    innerWidth: 0,
    innerHeight: 0,
    devicePixelRatio: 0,
    timezone: '',
    timezoneOffset: 0,
    webglVendor: null,
    webglRenderer: null,
    webglParams: {
      maxTextureSize: null,
      maxRenderbufferSize: null,
      maxVertexAttribs: null,
      maxViewportDims: null,
      aliasedLineWidthRange: null,
      shadingLanguageVersion: null,
      glVersion: null,
    },
    canvasHash: '',
    canvasWinding: null,
    audioHash: null,
    fontHash: '',
    fonts: [],
    clientRectsHash: '',
    capturedAt: new Date().toISOString(),
  };
}
