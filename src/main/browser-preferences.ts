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

/**
 * Configure per-profile browser chrome while Chromium is stopped.
 *
 * These are browser UI settings only: they do not touch page DOM, fingerprint
 * flags, cookies, or storage. CloakBrowser's built-in provider is deliberately
 * "No Search" (`http://{searchTerms}`), and Chromium protects the default
 * provider preference from external edits. A permission-free settings override
 * extension is therefore the supported way to make Google the omnibox provider.
 */
export function prepareBrowserPreferences(userDataDir: string): void {
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
