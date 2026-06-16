import { describe, it, expect } from 'vitest';
import { parseFingerprint, type RawProbe } from '../src/main/fingerprint-probe';

const raw: RawProbe = {
  userAgent: 'Mozilla/5.0 ... Chrome/146.0.0.0',
  platform: 'Win32',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  languages: ['en-US', 'en'],
  screenWidth: 1920, screenHeight: 1080, colorDepth: 24,
  devicePixelRatio: 1,
  webglVendor: 'Google Inc. (Intel)',
  webglRenderer: 'ANGLE (Intel)',
  timezone: 'America/New_York',
  webdriver: false,
};

describe('parseFingerprint', () => {
  it('maps raw probe to Fingerprint with screen object + capturedAt', () => {
    const fp = parseFingerprint(raw);
    expect(fp.screen).toEqual({ width: 1920, height: 1080, colorDepth: 24 });
    expect(fp.deviceMemory).toBe(8);
    expect(fp.webdriver).toBe(false);
    expect(fp.capturedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
  it('null deviceMemory when undefined', () => {
    const fp = parseFingerprint({ ...raw, deviceMemory: undefined });
    expect(fp.deviceMemory).toBeNull();
  });
});
