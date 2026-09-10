import type {
  Fingerprint, FingerprintFieldChange, Profile, ProfileHealth,
} from './types';

/**
 * Fields compared between the accepted baseline and the latest observation.
 *
 * `capturedAt` is excluded: it differs on every launch by definition, and
 * including it would make every profile look changed forever.
 */
const COMPARED: { field: string; read: (f: Fingerprint) => string | null }[] = [
  { field: 'userAgent', read: (f) => f.userAgent },
  { field: 'platform', read: (f) => f.platform },
  { field: 'hardwareConcurrency', read: (f) => String(f.hardwareConcurrency) },
  { field: 'deviceMemory', read: (f) => (f.deviceMemory == null ? null : String(f.deviceMemory)) },
  { field: 'languages', read: (f) => f.languages.join(',') },
  { field: 'screen', read: (f) => `${f.screen.width}x${f.screen.height}x${f.screen.colorDepth}` },
  { field: 'devicePixelRatio', read: (f) => String(f.devicePixelRatio) },
  { field: 'webglVendor', read: (f) => f.webglVendor },
  { field: 'webglRenderer', read: (f) => f.webglRenderer },
  { field: 'timezone', read: (f) => f.timezone },
  { field: 'webdriver', read: (f) => String(f.webdriver) },
];

export function fingerprintChanges(baseline: Fingerprint, observed: Fingerprint): FingerprintFieldChange[] {
  const out: FingerprintFieldChange[] = [];
  for (const { field, read } of COMPARED) {
    const a = read(baseline);
    const b = read(observed);
    if (a !== b) out.push({ field, baseline: a, observed: b });
  }
  return out;
}

/**
 * Compare what the profile is supposed to look like with what it last looked
 * like.
 *
 * Deliberate non-conclusions:
 *  - a profile with no baseline is `insufficient`, never "failed". An old
 *    profile that predates baselines has done nothing wrong.
 *  - an engine change is reported as such, not as evidence of tampering. It is
 *    the ordinary reason a fingerprint moves.
 *  - nothing here is scored or ranked; the caller shows the fields and lets the
 *    user decide.
 */
/** True when `a` happened after `b` (a missing `b` counts as older). */
function newer(a: string, b: string | null): boolean {
  if (!b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return ta >= tb;
}

export function profileHealth(p: Profile): ProfileHealth {
  const base = {
    changes: [] as FingerprintFieldChange[],
    engineChanged: false,
    baselineEngine: p.baseline?.engineVersion ?? null,
    observedEngine: p.lastObservation?.engineVersion ?? null,
    acceptedAt: p.baseline?.acceptedAt ?? null,
    observedAt: p.lastObservation?.observedAt ?? null,
    diagnosticsAt: p.diagnostics?.capturedAt ?? null,
  };

  // A failure is reported only when one was RECORDED, and only when it is the
  // most recent thing that happened. Inferring it from a missing observation
  // told profiles migrated from an old store that a check had failed when none
  // had ever run.
  const failure = p.lastObservationError;
  if (failure && newer(failure.at, p.lastObservation?.observedAt ?? null)) {
    return { ...base, state: 'check-failed', reason: `Lần đọc fingerprint gần nhất thất bại: ${failure.message}. Chưa kết luận được gì.` };
  }

  if (!p.baseline) {
    return {
      ...base,
      state: 'insufficient',
      reason: p.lastOpenedAt === null
        ? 'Chưa mở lần nào — chưa có gì để so sánh.'
        : 'Profile có từ trước khi app lưu baseline. Mở lại một lần để ghi baseline.',
    };
  }

  if (!p.lastObservation) {
    return {
      ...base,
      state: 'insufficient',
      reason: 'Có baseline nhưng chưa có lần đo nào sau đó. Mở profile một lần để có dữ liệu so sánh.',
    };
  }

  const changes = fingerprintChanges(p.baseline.fingerprint, p.lastObservation.fingerprint);
  const engineChanged = p.baseline.engineVersion !== p.lastObservation.engineVersion;

  if (changes.length === 0) {
    return {
      ...base,
      state: 'stable',
      engineChanged,
      reason: engineChanged
        ? `Khớp baseline, dù engine đã đổi (${p.baseline.engineVersion} → ${p.lastObservation.engineVersion}).`
        : 'Khớp baseline ở mọi trường được so sánh.',
    };
  }

  const names = changes.map((c) => c.field).join(', ');
  return {
    ...base,
    state: 'changed',
    changes,
    engineChanged,
    reason: engineChanged
      ? `${changes.length} trường đổi (${names}). Engine cũng đã đổi `
        + `(${p.baseline.engineVersion} → ${p.lastObservation.engineVersion}) — đây là lý do thông thường cho việc fingerprint đổi.`
      : `${changes.length} trường đổi (${names}) trong khi engine giữ nguyên.`,
  };
}
