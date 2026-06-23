import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

type JsonObject = Record<string, unknown>;

const GOOGLE_SEARCH_EXTENSION = 'manager-google-search';

const GOOGLE_SEARCH_MANIFEST: JsonObject = {
  manifest_version: 3,
  name: 'CloakBrowser Manager Google Search',
  version: '1.0.0',
  chrome_settings_overrides: {
    search_provider: {
      name: 'Google',
      keyword: 'google.com',
      search_url: 'https://www.google.com/search?q={searchTerms}',
      suggest_url: 'https://www.google.com/complete/search?client=chrome&q={searchTerms}',
      favicon_url: 'https://www.google.com/favicon.ico',
      encoding: 'UTF-8',
      is_default: true,
    },
  },
};

function objectAt(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  const object: JsonObject = {};
  parent[key] = object;
  return object;
}

export interface BrowserPreferencesOptions {
  /** true -> block the geolocation permission (denied); false -> reset to ask;
   *  undefined -> leave whatever is already in Preferences untouched. */
  blockGeolocation?: boolean;
  /** true -> send navigator.doNotTrack "1" + DNT header; false -> clear it;
   *  undefined -> leave untouched. */
  doNotTrack?: boolean;
}

/**
 * Configure per-profile browser settings while Chromium is stopped.
 *
 * Covers two kinds of REAL Chromium preferences (no page DOM, fingerprint
 * flags, cookies, or storage involved):
 *   1. Browser chrome — restore previous session, and a permission-free
 *      settings-override extension so Google is the omnibox provider
 *      (CloakBrowser ships "No Search" and protects the default provider pref).
 *   2. Privacy — block the geolocation permission and toggle Do Not Track via
 *      genuine Preferences keys. Verified 2026-06-22: `geolocation: 2` yields a
 *      "denied" permission and `enable_do_not_track: true` yields DNT "1" —
 *      undetectable as a JS override. Merges idempotently into any existing file.
 */
export function prepareBrowserPreferences(userDataDir: string, opts: BrowserPreferencesOptions = {}): void {
  const path = join(userDataDir, 'Default', 'Preferences');
  let preferences: JsonObject = {};
  if (existsSync(path)) {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid Chromium Preferences object: ${path}`);
    }
    preferences = parsed as JsonObject;
  }

  objectAt(preferences, 'session').restore_on_startup = 1;

  if (opts.blockGeolocation !== undefined) {
    const contentSettings = objectAt(objectAt(preferences, 'profile'), 'default_content_setting_values');
    if (opts.blockGeolocation) contentSettings.geolocation = 2;
    else delete contentSettings.geolocation;
  }

  if (opts.doNotTrack !== undefined) {
    if (opts.doNotTrack) preferences.enable_do_not_track = true;
    else delete preferences.enable_do_not_track;
  }

  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.manager-${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(preferences));
    renameSync(temporary, path);
  } finally {
    try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }

  const extensionDir = googleSearchExtensionPath(userDataDir);
  mkdirSync(extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifestTemporary = `${manifestPath}.manager-${process.pid}.tmp`;
  try {
    writeFileSync(manifestTemporary, JSON.stringify(GOOGLE_SEARCH_MANIFEST));
    renameSync(manifestTemporary, manifestPath);
  } finally {
    try { rmSync(manifestTemporary, { force: true }); } catch { /* best effort */ }
  }
}

export function googleSearchExtensionPath(userDataDir: string): string {
  return join(userDataDir, GOOGLE_SEARCH_EXTENSION);
}
