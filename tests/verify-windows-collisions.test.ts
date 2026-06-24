import { describe, it, expect } from 'vitest';
import { collisions } from '../scripts/verify-windows/collisions';
import type { ProfileObservation } from '../scripts/verify-windows/types';
import { errorObservation } from '../scripts/verify-windows/types';

/** A distinct, internally-fine observation; override fields to force collisions. */
function obs(id: string, over: Partial<ProfileObservation> = {}): ProfileObservation {
  return {
    profileId: id,
    profileName: id,
    seed: Number(id.replace(/\D/g, '')) || 1,
    ok: true,
    userAgent: `UA-${id}`,
    uaClientHints: null,
    platform: 'Win32',
    languages: ['en-US'],
    webdriver: false,
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24, pixelDepth: 24 },
    innerWidth: 2560,
    innerHeight: 1300,
    devicePixelRatio: 1,
    timezone: 'America/New_York',
    timezoneOffset: 300,
    webglVendor: `vendor-${id}`,
    webglRenderer: `renderer-${id}`,
    webglParams: {
      maxTextureSize: 16384, maxRenderbufferSize: 16384, maxVertexAttribs: 16,
      maxViewportDims: '32767,32767', aliasedLineWidthRange: '1,1',
      shadingLanguageVersion: 'WebGL GLSL ES 1.0', glVersion: 'WebGL 1.0',
    },
    canvasHash: `canvas-${id}`,
    canvasWinding: false,
    audioHash: `audio-${id}`,
    fontHash: `font-${id}`,
    fonts: [{ family: 'Arial', available: true }],
    clientRectsHash: `rects-${id}`,
    capturedAt: '2026-06-24T10:00:00.000Z',
    ...over,
  };
}

describe('collisions', () => {
  it('all-distinct profiles (every vector unique) produce no collision rows', () => {
    const distinct = (id: string, cores: number, mem: number, w: number): Partial<ProfileObservation> => ({
      hardwareConcurrency: cores,
      deviceMemory: mem,
      screen: { width: w, height: 1440, availWidth: w, availHeight: 1400, colorDepth: 24, pixelDepth: 24 },
    });
    expect(collisions([
      obs('p1', distinct('p1', 4, 8, 2560)),
      obs('p2', distinct('p2', 8, 4, 1920)),
      obs('p3', distinct('p3', 16, 2, 3440)),
    ])).toEqual([]);
  });

  it('two profiles sharing a canvas hash → HIGH collision on canvas', () => {
    const rows = collisions([
      obs('p1', { canvasHash: 'SAME' }),
      obs('p2', { canvasHash: 'SAME' }),
      obs('p3'),
    ]);
    const canvas = rows.find((r) => r.vector === 'canvas');
    expect(canvas).toBeDefined();
    expect(canvas!.severity).toBe('HIGH');
    expect(canvas!.groups).toHaveLength(1);
    expect(canvas!.groups[0].profileIds.sort()).toEqual(['p1', 'p2']);
    expect(canvas!.groups[0].value).toBe('SAME');
  });

  it('shared screen is reported as CONTEXT, not HIGH', () => {
    const rows = collisions([obs('p1'), obs('p2'), obs('p3')]); // all share 2560x1440
    const screen = rows.find((r) => r.vector === 'screen');
    expect(screen).toBeDefined();
    expect(screen!.severity).toBe('CONTEXT');
    expect(screen!.groups[0].profileIds.sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('flags each HIGH vector independently', () => {
    const rows = collisions([
      obs('p1', { audioHash: 'A', webglRenderer: 'R', fontHash: 'F', clientRectsHash: 'C' }),
      obs('p2', { audioHash: 'A', webglRenderer: 'R', fontHash: 'F', clientRectsHash: 'C' }),
    ]);
    const highVectors = rows.filter((r) => r.severity === 'HIGH').map((r) => r.vector).sort();
    expect(highVectors).toEqual(['audio', 'clientRects', 'fontHash', 'webglRenderer']);
  });

  it('does not group on null/error/sentinel values (two failed audios are not a linkage)', () => {
    const rows = collisions([
      obs('p1', { audioHash: null, canvasHash: 'no-canvas' }),
      obs('p2', { audioHash: null, canvasHash: 'canvas-error' }),
    ]);
    expect(rows.find((r) => r.vector === 'audio')).toBeUndefined();
    expect(rows.find((r) => r.vector === 'canvas')).toBeUndefined();
  });

  it('ignores failed (ok=false) observations', () => {
    const rows = collisions([
      obs('p1', { canvasHash: 'SAME' }),
      errorObservation('p2', 'p2', 2, 'launch failed'),
      obs('p3', { canvasHash: 'SAME' }),
    ]);
    const canvas = rows.find((r) => r.vector === 'canvas');
    expect(canvas!.groups[0].profileIds.sort()).toEqual(['p1', 'p3']);
  });

  it('separates two independent collision groups within one vector', () => {
    const rows = collisions([
      obs('p1', { fontHash: 'X' }), obs('p2', { fontHash: 'X' }),
      obs('p3', { fontHash: 'Y' }), obs('p4', { fontHash: 'Y' }),
      obs('p5', { fontHash: 'Z' }),
    ]);
    const font = rows.find((r) => r.vector === 'fontHash');
    expect(font!.groups).toHaveLength(2);
    expect(font!.groups.map((g) => g.value).sort()).toEqual(['X', 'Y']);
  });
});
