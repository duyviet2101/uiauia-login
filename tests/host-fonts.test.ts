import { describe, it, expect } from 'vitest';
import { findNonStandardFonts } from '../src/main/host-fonts';

describe('findNonStandardFonts', () => {
  const baseline = ['Arial', 'Segoe UI', 'Times New Roman', 'Calibri'];

  it('returns detected families not in the baseline', () => {
    expect(findNonStandardFonts(['Arial', 'Inter', 'Ubuntu Mono'], baseline)).toEqual(['Inter', 'Ubuntu Mono']);
  });

  it('returns [] when every detected family is stock', () => {
    expect(findNonStandardFonts(['Arial', 'Calibri', 'Segoe UI'], baseline)).toEqual([]);
  });

  it('returns [] for no detected fonts', () => {
    expect(findNonStandardFonts([], baseline)).toEqual([]);
  });

  it('compares case-insensitively', () => {
    expect(findNonStandardFonts(['ARIAL', 'calibri'], baseline)).toEqual([]);
  });

  it('normalizes internal/edge whitespace', () => {
    expect(findNonStandardFonts(['Segoe  UI', '  Times New Roman '], baseline)).toEqual([]);
  });

  it('preserves the original detected spelling of an offender', () => {
    expect(findNonStandardFonts(['FiraCode'], baseline)).toEqual(['FiraCode']);
  });

  it('de-duplicates offenders (case/space variants collapse to one)', () => {
    expect(findNonStandardFonts(['Inter', 'inter', 'INTER'], baseline)).toEqual(['Inter']);
  });

  it('flags Ubuntu Mono but not stock fonts against a realistic baseline', () => {
    const detected = ['Arial', 'Consolas', 'Ubuntu Mono', 'Segoe UI'];
    expect(findNonStandardFonts(detected, ['Arial', 'Consolas', 'Segoe UI'])).toEqual(['Ubuntu Mono']);
  });
});
