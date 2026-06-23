import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareBrowserPreferences } from '../src/main/browser-preferences';

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
});
