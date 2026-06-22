import { describe, expect, it } from 'vitest';
import {
  createWindowCustomization,
  defaultProfileIconColor,
  normalizeProfileIconColor,
  profileIconForeground,
  profileWindowTitle,
} from '../src/main/profile-window-customization';

describe('profile window customization', () => {
  it('cycles deterministic colors and normalizes custom hex', () => {
    expect(defaultProfileIconColor(1)).toBe('#2563EB');
    expect(defaultProfileIconColor(9)).toBe('#2563EB');
    expect(normalizeProfileIconColor('#abcdef', 1)).toBe('#ABCDEF');
    expect(normalizeProfileIconColor('not-a-color', 2)).toBe(defaultProfileIconColor(2));
    expect(profileIconForeground('#FFFFFF')).toBe('#0F172A');
    expect(profileIconForeground('#000000')).toBe('#FFFFFF');
  });

  it('creates enabled defaults without allowing the input to choose its number', () => {
    expect(createWindowCustomization(12, { enabled: false, color: '#112233' })).toEqual({
      enabled: false,
      number: 12,
      color: '#112233',
    });
  });

  it('sanitizes native titles without touching any page state', () => {
    expect(profileWindowTitle(12, '  Account\nOne\0 ')).toBe('[#12] Account One');
  });
});
