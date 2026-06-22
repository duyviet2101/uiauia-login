import type { GithubAsset, UpdaterAdapter } from './types';
import { isNewer } from './semver';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Chọn file .dmg khớp arch ('arm64' | 'x64'); fallback dmg không hậu tố, rồi dmg đầu tiên. */
export function pickDmgAsset(assets: GithubAsset[], arch: string): GithubAsset | null {
  const dmgs = assets.filter((x) => x.name.toLowerCase().endsWith('.dmg'));
  if (dmgs.length === 0) return null;
  const wantArm = arch === 'arm64';
  const tagged = dmgs.find((x) => {
    const n = x.name.toLowerCase();
    return wantArm ? n.includes('arm64') : (n.includes('x64') || n.includes('x86_64') || n.includes('intel'));
  });
  if (tagged) return tagged;
  const untagged = dmgs.find((x) => !/arm64|x64|x86_64|intel/i.test(x.name));
  return untagged ?? dmgs[0];
}

interface ReleaseJson { tag_name?: string; html_url?: string; assets?: GithubAsset[] }

interface MacUpdaterOpts {
  arch?: string;
  fetcher?: typeof fetch;
  openPath?: (p: string) => Promise<string>;
  openExternal?: (u: string) => Promise<void>;
  tmpDir?: () => string;
}

export class MacUpdater implements UpdaterAdapter {
  readonly canAutoInstall = false;
  private dmgUrl: string | null = null;
  private htmlUrl: string | null = null;
  private downloadedPath: string | null = null;

  constructor(private repo: string, private opts: MacUpdaterOpts = {}) {}

  /** URL dmg đã chọn ở lần check gần nhất (đọc cho test/UI). */
  get downloadUrl(): string | null { return this.dmgUrl; }

  private get arch(): string { return this.opts.arch ?? process.arch; }
  private get fetcher(): typeof fetch { return this.opts.fetcher ?? fetch; }

  async check(current: string): Promise<{ available: boolean; latest: string | null }> {
    const res = await this.fetcher(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CloakBrowserManager' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = (await res.json()) as ReleaseJson;
    const latest = data.tag_name ?? null;
    this.htmlUrl = data.html_url ?? null;
    this.dmgUrl = pickDmgAsset(data.assets ?? [], this.arch)?.browser_download_url ?? null;
    return { available: !!latest && isNewer(latest, current), latest };
  }

  private async openPathFn(p: string): Promise<string> {
    if (this.opts.openPath) return this.opts.openPath(p);
    const { shell } = await import('electron');
    return shell.openPath(p);
  }

  private async openExternalFn(u: string): Promise<void> {
    if (this.opts.openExternal) return this.opts.openExternal(u);
    const { shell } = await import('electron');
    return shell.openExternal(u);
  }

  async start(onProgress: (percent: number) => void): Promise<{ ready: boolean; artifactPath?: string }> {
    if (!this.dmgUrl) {
      if (this.htmlUrl) await this.openExternalFn(this.htmlUrl); // fallback: mở trang release
      return { ready: false };
    }
    const res = await this.fetcher(this.dmgUrl);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const dest = join(this.opts.tmpDir ? this.opts.tmpDir() : tmpdir(), 'CloakBrowserManager-update.dmg');
    const file = createWriteStream(dest);
    let received = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        file.write(Buffer.from(value));
        received += value.length;
        if (total > 0) onProgress(Math.round((received / total) * 100));
      }
    } finally {
      file.end();
    }
    await new Promise<void>((resolve, reject) => {
      file.on('finish', () => resolve());
      file.on('error', reject);
    });
    this.downloadedPath = dest;
    return { ready: true, artifactPath: dest };
  }

  async apply(): Promise<void> {
    if (this.downloadedPath) await this.openPathFn(this.downloadedPath);
  }
}
