import type { CollisionRow, CollisionSeverity, ProfileObservation } from './types';

/**
 * Vectors we test for cross-profile linkage. `extract` returns the comparable
 * value, or null to exclude a profile from grouping on that vector (a null /
 * error / sentinel value is a failed measurement, not a shared identity — two
 * null audios are two failures, not a linkage).
 */
interface VectorSpec {
  vector: string;
  severity: CollisionSeverity;
  extract: (o: ProfileObservation) => string | null;
}

// A real high-entropy hash must never be one of these placeholders.
const CANVAS_SENTINELS = new Set(['', 'no-canvas', 'canvas-error']);
const FONT_SENTINELS = new Set(['', 'no-font-canvas']);

function nonEmpty(v: string | null | undefined): string | null {
  return v == null || v === '' ? null : v;
}

const VECTORS: VectorSpec[] = [
  // HIGH — a byte-identical match between two profiles is a linkage.
  { vector: 'canvas', severity: 'HIGH', extract: (o) => (CANVAS_SENTINELS.has(o.canvasHash) ? null : o.canvasHash) },
  { vector: 'audio', severity: 'HIGH', extract: (o) => nonEmpty(o.audioHash) },
  { vector: 'webglRenderer', severity: 'HIGH', extract: (o) => nonEmpty(o.webglRenderer) },
  { vector: 'fontHash', severity: 'HIGH', extract: (o) => (FONT_SENTINELS.has(o.fontHash) ? null : o.fontHash) },
  { vector: 'clientRects', severity: 'HIGH', extract: (o) => nonEmpty(o.clientRectsHash) },
  // CONTEXT — some sharing is plausible on real machines; reported, not auto-failed.
  { vector: 'screen', severity: 'CONTEXT', extract: (o) => `${o.screen.width}x${o.screen.height}` },
  { vector: 'cores', severity: 'CONTEXT', extract: (o) => String(o.hardwareConcurrency) },
  { vector: 'memory', severity: 'CONTEXT', extract: (o) => (o.deviceMemory == null ? null : String(o.deviceMemory)) },
  { vector: 'ua', severity: 'CONTEXT', extract: (o) => nonEmpty(o.userAgent) },
];

/**
 * Group profiles by identical value per tracked vector. Any value shared by ≥2
 * profiles is a collision; HIGH vectors mean device linkage, CONTEXT vectors are
 * reported for judgement. Failed observations (ok=false) are ignored entirely.
 */
export function collisions(observations: ProfileObservation[]): CollisionRow[] {
  const live = observations.filter((o) => o.ok);
  const rows: CollisionRow[] = [];

  for (const spec of VECTORS) {
    const byValue = new Map<string, string[]>();
    for (const o of live) {
      const value = spec.extract(o);
      if (value == null) continue;
      const ids = byValue.get(value) ?? byValue.set(value, []).get(value)!;
      ids.push(o.profileId);
    }
    const groups = [...byValue.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([value, ids]) => ({ value, profileIds: ids }));
    if (groups.length) rows.push({ vector: spec.vector, severity: spec.severity, groups });
  }

  return rows;
}

/** True when any HIGH-severity collision exists — the headline pass/fail gate. */
export function hasHighCollision(rows: CollisionRow[]): boolean {
  return rows.some((r) => r.severity === 'HIGH');
}
