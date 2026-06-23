import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareBrowserPreferences } from '../src/main/browser-preferences';

const readPrefs = (dir: string) => JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'));

describe('prepareBrowserPreferences', () => {
  it('creates a Google omnibox override and restores the previous session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir);
    const preferences = JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir, 'manager-google-search', 'manifest.json'), 'utf8'));

    expect(preferences.session.restore_on_startup).toBe(1);
    expect(manifest.chrome_settings_overrides.search_provider).toMatchObject({
      name: 'Google',
      keyword: 'google.com',
      search_url: 'https://www.google.com/search?q={searchTerms}',
      is_default: true,
    });
  });

  it('preserves unrelated Chromium preferences', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    const path = join(dir, 'Default', 'Preferences');
    prepareBrowserPreferences(dir);
    const existing = JSON.parse(readFileSync(path, 'utf8'));
    existing.browser = { custom_chrome_frame: true };
    writeFileSync(path, JSON.stringify(existing));

    prepareBrowserPreferences(dir);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.browser.custom_chrome_frame).toBe(true);
  });

  it('blocks geolocation and enables Do Not Track when requested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir, { blockGeolocation: true, doNotTrack: true });
    const p = readPrefs(dir);
    expect(p.profile.default_content_setting_values.geolocation).toBe(2);
    expect(p.enable_do_not_track).toBe(true);
  });

  it('merges privacy settings without dropping existing preferences', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    mkdirSync(join(dir, 'Default'), { recursive: true });
    writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({ foo: 1, profile: { name: 'x' } }));
    prepareBrowserPreferences(dir, { blockGeolocation: true, doNotTrack: false });
    const p = readPrefs(dir);
    expect(p.foo).toBe(1);
    expect(p.profile.name).toBe('x');
    expect(p.profile.default_content_setting_values.geolocation).toBe(2);
    expect(p.enable_do_not_track).toBeUndefined();
  });

  it('clears the geolocation block when blockGeolocation is false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir, { blockGeolocation: true, doNotTrack: true });
    prepareBrowserPreferences(dir, { blockGeolocation: false, doNotTrack: false });
    const p = readPrefs(dir);
    expect(p.profile.default_content_setting_values.geolocation).toBeUndefined();
    expect(p.enable_do_not_track).toBeUndefined();
  });

  it('leaves geolocation and DNT untouched when no privacy options are passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir);
    const p = readPrefs(dir);
    expect(p.profile?.default_content_setting_values?.geolocation).toBeUndefined();
    expect(p.enable_do_not_track).toBeUndefined();
  });

  it('always blocks the Local Font Access permission (local_fonts=2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir); // even with no privacy opts
    expect(readPrefs(dir).profile.default_content_setting_values.local_fonts).toBe(2);
  });

  it('blocks Local Font Access alongside an explicit geolocation block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-preferences-'));
    prepareBrowserPreferences(dir, { blockGeolocation: true, doNotTrack: false });
    const csv = readPrefs(dir).profile.default_content_setting_values;
    expect(csv.local_fonts).toBe(2);
    expect(csv.geolocation).toBe(2);
  });
});
