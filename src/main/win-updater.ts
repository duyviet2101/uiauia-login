import { isNewer } from './semver';
import type { UpdaterAdapter } from './types';

/** Phần API của electron-updater `autoUpdater` mà ta dùng (để inject + test). */
export interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, cb: (...args: unknown[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

function isElectronAutoUpdater(value: unknown): value is ElectronAutoUpdater {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ElectronAutoUpdater>;
  return (
    typeof candidate.on === 'function' &&
    typeof candidate.checkForUpdates === 'function' &&
    typeof candidate.downloadUpdate === 'function' &&
    typeof candidate.quitAndInstall === 'function'
  );
}

function readAutoUpdater(value: unknown): unknown {
  try {
    return (value as { autoUpdater?: unknown })?.autoUpdater;
  } catch {
    return undefined;
  }
}

/** Dynamic import of electron-updater exposes autoUpdater under default in ESM. */
export function resolveElectronAutoUpdater(module: unknown): ElectronAutoUpdater {
  const mod = module as { autoUpdater?: unknown; default?: unknown } | null | undefined;
  const candidates = [
    readAutoUpdater(mod),
    readAutoUpdater(mod?.default),
  ];
  const autoUpdater = candidates.find(isElectronAutoUpdater);
  if (!autoUpdater) throw new Error('electron-updater autoUpdater export was not found.');
  return autoUpdater;
}

export class WinUpdater implements UpdaterAdapter {
  readonly canAutoInstall = true;
  private latest: string | null = null;
  private onProgress: ((p: number) => void) | null = null;
  private resolveDownloaded: ((r: { ready: boolean }) => void) | null = null;
  private downloading: Promise<{ ready: boolean }> | null = null;

  constructor(private au: ElectronAutoUpdater) {
    au.autoDownload = false;
    au.autoInstallOnAppQuit = false;
    au.on('update-available', (info) => {
      this.latest = (info as { version?: string })?.version ?? null;
    });
    au.on('download-progress', (p) => {
      const pct = (p as { percent?: number })?.percent;
      if (this.onProgress && pct != null) this.onProgress(Math.round(pct));
    });
    au.on('update-downloaded', () => {
      this.resolveDownloaded?.({ ready: true });
      this.resolveDownloaded = null;
    });
    au.on('error', () => { /* lỗi nổi qua check()/start() reject */ });
  }

  async check(current: string): Promise<{ available: boolean; latest: string | null }> {
    const res = (await this.au.checkForUpdates()) as { updateInfo?: { version?: string } } | null;
    const v = res?.updateInfo?.version ?? this.latest;
    this.latest = v ?? null;
    return { available: !!v && isNewer(v, current), latest: this.latest };
  }

  async start(onProgress: (p: number) => void): Promise<{ ready: boolean; artifactPath?: string }> {
    if (this.downloading) return this.downloading;
    this.onProgress = onProgress;
    this.downloading = new Promise<{ ready: boolean }>((resolve) => { this.resolveDownloaded = resolve; });
    try {
      await this.au.downloadUpdate();
      return await this.downloading;
    } finally {
      this.downloading = null;
      this.resolveDownloaded = null;
    }
  }

  async apply(): Promise<void> {
    this.au.quitAndInstall();
  }
}
