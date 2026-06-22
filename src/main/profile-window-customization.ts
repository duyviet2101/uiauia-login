import type { WindowCustomization, WindowCustomizationInput } from './types';

export const PROFILE_ICON_COLORS = [
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#16A34A',
  '#0891B2',
  '#475569',
] as const;

const HEX_COLOR = /^#[0-9A-F]{6}$/;

export function defaultProfileIconColor(number: number): string {
  const index = Math.max(0, Math.trunc(number) - 1) % PROFILE_ICON_COLORS.length;
  return PROFILE_ICON_COLORS[index];
}

export function normalizeProfileIconColor(color: unknown, number: number): string {
  if (typeof color !== 'string') return defaultProfileIconColor(number);
  const normalized = color.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : defaultProfileIconColor(number);
}

export function profileIconForeground(background: string): string {
  const color = normalizeProfileIconColor(background, 1);
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#0F172A' : '#FFFFFF';
}

export function createWindowCustomization(
  number: number,
  input: WindowCustomizationInput = {},
): WindowCustomization {
  return {
    enabled: input.enabled ?? true,
    number,
    color: normalizeProfileIconColor(input.color, number),
  };
}

export function profileWindowTitle(number: number, name: string): string {
  const safeName = name.replace(/[\0\r\n]+/g, ' ').trim() || 'Profile';
  return `[#${number}] ${safeName}`;
}
