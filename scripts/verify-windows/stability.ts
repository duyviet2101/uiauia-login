// Pure analysis over a run's observations.
//
// The old harness answered one question ("do two profiles share a value?") from
// one measurement each. That conflates three very different things, so they are
// separated here:
//
//   1. in-session variance  — the same profile, same open, measured N times.
//      Any difference here is measurement noise (or deliberate per-call noise),
//      and it makes cross-profile comparison of that field meaningless.
//   2. across-open drift    — the same profile, reopened. A field that changes
//      here is an identity-stability problem, regardless of other profiles.
//   3. cross-profile sharing — different profiles reporting the same value.
//      Only meaningful for fields that are stable in (1) and (2).
//
// A field that could not be measured is never grouped: `unsupported` and `error`
// are recorded per profile and excluded, so two failures never look like a match.

import type { ProfileObservation } from './types';
import type { Measured } from './measure';

export type FieldValue =
  | { status: 'ok'; value: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string };

export interface FieldSpec {
  field: string;
  /** HIGH = sharing implies device linkage. CONTEXT = plausibly shared on real machines. */
  severity: 'HIGH' | 'CONTEXT';
  get: (o: ProfileObservation) => FieldValue;
}

export interface PerProfileStability {
  profileId: string;
  profileName: string;
  seed: number;
  /** Distinct values seen within a single open (should be 1 for a stable field). */
  inSessionDistinct: number;
  /** Distinct values seen across opens (should be 1 for a stable identity). */
  acrossOpenDistinct: number;
  /** One representative value per open, in open order. */
  perOpen: string[];
  /** Measurements that did not produce a value. */
  notMeasured: { status: string; reason: string; count: number }[];
}

export interface StabilityRow {
  field: string;
  severity: 'HIGH' | 'CONTEXT';
  profiles: PerProfileStability[];
  /** True when every profile reported one value within each open. */
  inSessionStable: boolean;
  /** True when every profile reported one value across all its opens. */
  acrossOpenStable: boolean;
  /** Values shared by >=2 profiles (only computed from stable, ok values). */
  sharedBy: { value: string; profileIds: string[] }[];
  /** Number of profiles that produced at least one usable value. */
  measuredProfiles: number;
}

const digest = (m: Measured<{ digest: string }> | undefined, missing: string): FieldValue => {
  if (!m) return { status: 'unsupported', reason: missing };
  if (m.status === 'ok') return { status: 'ok', value: m.value.digest };
  return { status: m.status, reason: m.reason };
};

const plain = (value: string | number | null | undefined, missing: string): FieldValue =>
  value == null || value === '' ? { status: 'unsupported', reason: missing } : { status: 'ok', value: String(value) };

/**
 * Rich measurement first, legacy flat digest as a fallback. Observations
 * recorded before the measurement envelope existed only carry the flat fields;
 * ignoring them would silently drop those runs out of the analysis.
 */
const digestOrLegacy = (
  m: Measured<{ digest: string }> | undefined,
  legacy: string | null | undefined,
  missing: string,
): FieldValue => {
  if (m) return digest(m, missing);
  return plain(legacy, missing);
};

/** The default field set analysed for every run. */
export function defaultFields(): FieldSpec[] {
  return [
    // Canvas has TWO independent read paths and they do not behave the same on
    // every binary. Measured 2026-09-09 on the macOS 145 build: the EXPORT path
    // (toDataURL / toBlob, all formats) returns byte-identical output for every
    // seed, while getImageData and measureText are noised per seed. The export
    // path is the one FingerprintJS / browserleaks / CreepJS actually read, so it
    // must be tracked separately — reporting only the pixel path would hide a
    // real linkage behind an artificial difference.
    {
      field: 'canvas.text.export',
      severity: 'HIGH',
      get: (o) => {
        const m = o.measurements?.canvasText;
        if (!m) return plain(o.canvasHash, 'canvasText not measured');
        return m.status === 'ok' ? { status: 'ok', value: m.value.digest } : { status: m.status, reason: m.reason };
      },
    },
    {
      field: 'canvas.geometry.export',
      severity: 'HIGH',
      get: (o) => {
        const m = o.measurements?.canvasGeometry;
        if (!m) return { status: 'unsupported', reason: 'canvasGeometry not measured' };
        return m.status === 'ok' ? { status: 'ok', value: m.value.digest } : { status: m.status, reason: m.reason };
      },
    },
    {
      field: 'canvas.text.imagedata',
      severity: 'HIGH',
      get: (o) => {
        const m = o.measurements?.canvasText;
        if (!m) return { status: 'unsupported', reason: 'canvasText not measured' };
        return m.status === 'ok' ? { status: 'ok', value: m.value.pixelDigest } : { status: m.status, reason: m.reason };
      },
    },
    {
      field: 'canvas.geometry.imagedata',
      severity: 'HIGH',
      get: (o) => {
        const m = o.measurements?.canvasGeometry;
        if (!m) return { status: 'unsupported', reason: 'canvasGeometry not measured' };
        return m.status === 'ok' ? { status: 'ok', value: m.value.pixelDigest } : { status: m.status, reason: m.reason };
      },
    },
    { field: 'audio', severity: 'HIGH', get: (o) => digestOrLegacy(o.measurements?.audio, o.audioHash, 'audio not measured') },
    {
      field: 'font.metrics',
      severity: 'HIGH',
      get: (o) => digest(o.measurements?.fontMetrics, 'fontMetrics not measured'),
    },
    {
      field: 'font.availability',
      severity: 'HIGH',
      get: (o) => digestOrLegacy(o.measurements?.fontAvailability, o.fontHash, 'fontAvailability not measured'),
    },
    {
      field: 'clientRects',
      severity: 'HIGH',
      get: (o) => digestOrLegacy(o.measurements?.clientRects, o.clientRectsHash, 'clientRects not measured'),
    },
    { field: 'webgl.renderer', severity: 'HIGH', get: (o) => plain(o.webglRenderer, 'renderer unavailable') },
    {
      field: 'webrtc.addresses',
      severity: 'HIGH',
      get: (o) => {
        const m = o.measurements?.webrtc;
        if (!m) return { status: 'unsupported', reason: 'webrtc not measured' };
        if (m.status !== 'ok') return { status: m.status, reason: m.reason };
        if (m.value.candidates.length === 0) return { status: 'unsupported', reason: 'no ICE candidates gathered' };
        return {
          status: 'ok',
          value: m.value.candidates.map((c) => `${c.type}:${c.addressDigest.slice(0, 12)}`).sort().join(','),
        };
      },
    },
    { field: 'webgl.vendor', severity: 'CONTEXT', get: (o) => plain(o.webglVendor, 'vendor unavailable') },
    { field: 'screen', severity: 'CONTEXT', get: (o) => plain(`${o.screen.width}x${o.screen.height}`, 'no screen') },
    { field: 'cores', severity: 'CONTEXT', get: (o) => plain(o.hardwareConcurrency, 'no cores') },
    { field: 'memory', severity: 'CONTEXT', get: (o) => plain(o.deviceMemory, 'deviceMemory not exposed') },
    { field: 'ua', severity: 'CONTEXT', get: (o) => plain(o.userAgent, 'no UA') },
    { field: 'timezone', severity: 'CONTEXT', get: (o) => plain(o.timezone, 'no timezone') },
    { field: 'devicePixelRatio', severity: 'CONTEXT', get: (o) => plain(o.devicePixelRatio, 'no DPR') },
  ];
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function analyzeStability(
  observations: ProfileObservation[],
  fields: FieldSpec[] = defaultFields(),
): StabilityRow[] {
  const live = observations.filter((o) => o.ok);
  const byProfile = groupBy(live, (o) => o.profileId);

  return fields.map((spec) => {
    const profiles: PerProfileStability[] = [];

    for (const [profileId, rows] of byProfile) {
      const byOpen = groupBy(rows, (o) => String(o.openIndex ?? 1));
      const perOpen: string[] = [];
      const notMeasured = new Map<string, { status: string; reason: string; count: number }>();
      let inSessionDistinct = 1;

      const openKeys = [...byOpen.keys()].sort((a, b) => Number(a) - Number(b));
      for (const key of openKeys) {
        const values: string[] = [];
        for (const o of byOpen.get(key)!) {
          const v = spec.get(o);
          if (v.status === 'ok') {
            values.push(v.value);
          } else {
            const k = `${v.status}:${v.reason}`;
            const existing = notMeasured.get(k);
            if (existing) existing.count++;
            else notMeasured.set(k, { status: v.status, reason: v.reason, count: 1 });
          }
        }
        const distinct = new Set(values).size;
        if (distinct > inSessionDistinct) inSessionDistinct = distinct;
        if (values.length > 0) perOpen.push(values[0]);
      }

      const sample = rows[0];
      profiles.push({
        profileId,
        profileName: sample.profileName,
        seed: sample.seed,
        inSessionDistinct: perOpen.length === 0 ? 0 : inSessionDistinct,
        acrossOpenDistinct: new Set(perOpen).size,
        perOpen,
        notMeasured: [...notMeasured.values()],
      });
    }

    const measuredProfiles = profiles.filter((p) => p.perOpen.length > 0).length;
    const inSessionStable = profiles.every((p) => p.perOpen.length === 0 || p.inSessionDistinct === 1);
    const acrossOpenStable = profiles.every((p) => p.perOpen.length === 0 || p.acrossOpenDistinct === 1);

    // Cross-profile sharing: only compare profiles whose value is stable across
    // their own opens, otherwise "shared" is not a well-defined claim.
    const byValue = new Map<string, string[]>();
    for (const p of profiles) {
      if (p.perOpen.length === 0 || p.acrossOpenDistinct !== 1) continue;
      const value = p.perOpen[0];
      const ids = byValue.get(value);
      if (ids) ids.push(p.profileId);
      else byValue.set(value, [p.profileId]);
    }
    const sharedBy = [...byValue.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([value, profileIds]) => ({ value, profileIds }));

    return { field: spec.field, severity: spec.severity, profiles, inSessionStable, acrossOpenStable, sharedBy, measuredProfiles };
  });
}

/** Fields where every measured profile shares one value — the linkage headline. */
export function fullyShared(rows: StabilityRow[]): StabilityRow[] {
  return rows.filter(
    (r) =>
      r.severity === 'HIGH' &&
      r.measuredProfiles >= 2 &&
      r.sharedBy.length === 1 &&
      r.sharedBy[0].profileIds.length === r.measuredProfiles,
  );
}

/** Fields that changed between opens of the same profile — identity drift. */
export function driftingFields(rows: StabilityRow[]): { field: string; profileId: string; values: string[] }[] {
  const out: { field: string; profileId: string; values: string[] }[] = [];
  for (const row of rows) {
    for (const p of row.profiles) {
      if (p.acrossOpenDistinct > 1) out.push({ field: row.field, profileId: p.profileId, values: p.perOpen });
    }
  }
  return out;
}

/** Fields that were not reproducible even within one open — measurement noise. */
export function noisyFields(rows: StabilityRow[]): { field: string; profileId: string }[] {
  const out: { field: string; profileId: string }[] = [];
  for (const row of rows) {
    for (const p of row.profiles) {
      if (p.inSessionDistinct > 1) out.push({ field: row.field, profileId: p.profileId });
    }
  }
  return out;
}
