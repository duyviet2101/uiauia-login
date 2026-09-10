// Measurement envelope + rich sample shapes.
//
// A measurement has three distinct outcomes and they must never collapse into a
// shared `null`: `ok` (we have a value), `unsupported` (the API is absent in
// this context — normal, not a defect) and `error` (the measurement itself
// failed). Collision analysis may only group `ok` values; two `error`s are two
// failures, not a shared identity.

export type Measured<T> =
  | { status: 'ok'; value: T }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string };

export function isOk<T>(m: Measured<T> | undefined): m is { status: 'ok'; value: T } {
  return !!m && m.status === 'ok';
}

/** The `ok` value, or undefined for unsupported/error. Never conflate the two. */
export function valueOf<T>(m: Measured<T> | undefined): T | undefined {
  return isOk(m) ? m.value : undefined;
}

// ---------------------------------------------------------------------------
// Sample shapes
// ---------------------------------------------------------------------------

/** One canvas workload. `digest` is SHA-256; the extra fields let us tell a
 *  render difference from a serialization difference. */
export interface CanvasSample {
  /** Workload name — 'text' or 'geometry'. */
  workload: string;
  digest: string;
  /** Length of the data URL; differs when encoding differs, not just pixels. */
  dataUrlLength: number;
  /** SHA-256 over the raw RGBA bytes (getImageData), independent of PNG encoding. */
  pixelDigest: string;
  /** A few sampled RGBA values — human-readable evidence behind the digest. */
  pixelSamples: number[];
  /** Sum of all non-transparent pixel values; a coarse render-content check. */
  pixelSum: number;
  winding: boolean | null;
}

export interface AudioSample {
  digest: string;
  sampleCount: number;
  nonZeroCount: number;
  min: number;
  max: number;
  mean: number;
  /** First few rendered samples — evidence behind the digest. */
  head: number[];
}

export interface FontAvailability {
  family: string;
  available: boolean;
}

export interface FontAvailabilitySample {
  digest: string;
  families: FontAvailability[];
  availableCount: number;
  totalCount: number;
}

/** One text-metrics measurement: the raw numbers, not just a hash. */
export interface FontMetric {
  key: string;
  width: number;
  ascent: number | null;
  descent: number | null;
}

export interface FontMetricsSample {
  digest: string;
  metrics: FontMetric[];
}

export interface ClientRectSample {
  digest: string;
  /** Raw rect numbers at full precision, so a later run can diff the values. */
  rects: { key: string; values: number[] }[];
}

/** One ICE candidate, with the address masked for artifacts. */
export interface IceCandidate {
  type: string;
  protocol: string;
  /** Masked form, e.g. "192.168.x.x" or "<uuid>.local" — safe to commit. */
  address: string;
  /** SHA-256 of the full address, so collisions are detectable without storing it. */
  addressDigest: string;
  /** True when the address is an mDNS .local name (Chromium's default obfuscation). */
  mdns: boolean;
  /** True when the address is a routable public IP (the real leak case). */
  publicIp: boolean;
}

export interface WebrtcSample {
  candidates: IceCandidate[];
  /** Gathering finished before the timeout. */
  complete: boolean;
  /** Distinct masked addresses seen, for a quick read in the report. */
  addresses: string[];
}
