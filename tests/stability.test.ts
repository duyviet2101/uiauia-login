import { describe, it, expect } from 'vitest';
import { analyzeStability, fullyShared, noisyFields, type FieldSpec } from '../scripts/verify-windows/stability';
import type { ProfileObservation } from '../scripts/verify-windows/types';

/**
 * One measurement. `value` is what the field reported on that call, so a test
 * can make a profile return different values inside a single open.
 */
function obs(profileId: string, openIndex: number, measureIndex: number, value: string): ProfileObservation {
  return {
    profileId,
    profileName: profileId,
    seed: 1,
    ok: true,
    capturedAt: '2026-09-11T00:00:00.000Z',
    openIndex,
    measureIndex,
    // The field spec below reads this back out.
    userAgent: value,
  } as unknown as ProfileObservation;
}

const field: FieldSpec = {
  field: 'test',
  severity: 'HIGH',
  get: (o) => ({ status: 'ok', value: String((o as unknown as { userAgent: string }).userAgent) }),
};

describe('analyzeStability — cross-profile sharing', () => {
  it('does not call a field shared when the profiles are noisy WITHIN an open', () => {
    // Reported by review: perOpen keeps only the FIRST value of each open, so a
    // profile cycling A,B inside every open looks like [A, A] across opens. Two
    // such profiles used to come out as fully shared while inSessionStable was
    // false in the very same row — noise read as linkage.
    const observations = [
      obs('p1', 1, 1, 'A'), obs('p1', 1, 2, 'B'),
      obs('p1', 2, 1, 'A'), obs('p1', 2, 2, 'B'),
      obs('p2', 1, 1, 'A'), obs('p2', 1, 2, 'C'),
      obs('p2', 2, 1, 'A'), obs('p2', 2, 2, 'C'),
    ];
    const [row] = analyzeStability(observations, [field]);

    expect(row.inSessionStable).toBe(false);
    expect(row.sharedBy).toEqual([]);
    expect(fullyShared([row])).toEqual([]);
    expect(row.excludedFromSharing).toEqual([
      { profileId: 'p1', reason: 'noisy-in-session' },
      { profileId: 'p2', reason: 'noisy-in-session' },
    ]);
    // The noise itself is still reported — it is excluded from the sharing
    // claim, not swept away.
    expect(noisyFields([row]).map((n) => n.profileId)).toEqual(['p1', 'p2']);
  });

  it('still reports genuine sharing when every profile is stable', () => {
    const observations = [
      obs('p1', 1, 1, 'SAME'), obs('p1', 1, 2, 'SAME'),
      obs('p1', 2, 1, 'SAME'), obs('p1', 2, 2, 'SAME'),
      obs('p2', 1, 1, 'SAME'), obs('p2', 1, 2, 'SAME'),
      obs('p2', 2, 1, 'SAME'), obs('p2', 2, 2, 'SAME'),
    ];
    const [row] = analyzeStability(observations, [field]);

    expect(row.inSessionStable).toBe(true);
    expect(row.acrossOpenStable).toBe(true);
    expect(row.sharedBy).toEqual([{ value: 'SAME', profileIds: ['p1', 'p2'] }]);
    expect(row.excludedFromSharing).toEqual([]);
    expect(fullyShared([row]).map((r) => r.field)).toEqual(['test']);
  });

  it('excludes a profile that drifts across opens, and stays quiet about the rest', () => {
    const observations = [
      obs('p1', 1, 1, 'SAME'), obs('p1', 2, 1, 'SAME'),
      obs('p2', 1, 1, 'SAME'), obs('p2', 2, 1, 'SAME'),
      obs('p3', 1, 1, 'SAME'), obs('p3', 2, 1, 'MOVED'),
    ];
    const [row] = analyzeStability(observations, [field]);

    expect(row.sharedBy).toEqual([{ value: 'SAME', profileIds: ['p1', 'p2'] }]);
    expect(row.excludedFromSharing).toEqual([{ profileId: 'p3', reason: 'drifts-across-opens' }]);
    // Two of three profiles sharing is NOT the "every profile is one device"
    // headline, and must not be announced as one.
    expect(fullyShared([row])).toEqual([]);
  });

  it('never groups two failed measurements as a shared value', () => {
    const failing: FieldSpec = {
      field: 'test',
      severity: 'HIGH',
      get: () => ({ status: 'error', reason: 'probe blew up' }),
    };
    const observations = [obs('p1', 1, 1, 'x'), obs('p2', 1, 1, 'x')];
    const [row] = analyzeStability(observations, [failing]);

    expect(row.measuredProfiles).toBe(0);
    expect(row.sharedBy).toEqual([]);
    expect(fullyShared([row])).toEqual([]);
  });
});
