import { app } from 'electron';
import type { UpdateInfo } from './types';

/**
 * GitHub repo that hosts the Releases used for the update check, as
 * "owner/repo". Set to null to disable the online check entirely (the app then
 * just reports the current version — fine for hand-delivered DMGs).
 */
const GITHUB_REPO: string | null = 'duyviet2101/uiauia-login';

function parseSemver(v: string): number[] {
  return v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** True when `latest` is a strictly higher semver than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Compare the running version against the latest GitHub Release. Never throws —
 * on any failure (offline, repo missing, no releases) it returns hasUpdate:false
 * so the rest of the app keeps working.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  if (!GITHUB_REPO) return { current, latest: null, hasUpdate: false, url: null };

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CloakBrowserManager' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = data.tag_name ?? null;
    return {
      current,
      latest,
      hasUpdate: !!latest && isNewer(latest, current),
      url: data.html_url ?? null,
    };
  } catch (e) {
    return { current, latest: null, hasUpdate: false, url: null, error: e instanceof Error ? e.message : String(e) };
  }
}
