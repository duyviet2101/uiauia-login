import type { UpdateStatus, UpdaterAdapter } from './types';

type Broadcast = (status: UpdateStatus) => void;
type Platform = 'win32' | 'darwin' | 'other';

export class UpdateService {
  private status: UpdateStatus;

  constructor(
    private adapter: UpdaterAdapter,
    current: string,
    platform: Platform,
    private broadcast: Broadcast,
  ) {
    this.status = { state: 'idle', platform, current, latest: null, canAutoInstall: adapter.canAutoInstall };
  }

  getStatus(): UpdateStatus { return this.status; }

  private set(partial: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...partial };
    this.broadcast(this.status);
  }

  async check(): Promise<UpdateStatus> {
    this.set({ state: 'checking', error: undefined });
    try {
      const { available, latest } = await this.adapter.check(this.status.current);
      this.set({ state: available ? 'available' : 'up-to-date', latest });
    } catch (e) {
      this.set({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
    return this.status;
  }

  async start(): Promise<void> {
    this.set({ state: 'downloading', percent: 0 });
    try {
      const { ready } = await this.adapter.start((percent) => this.set({ state: 'downloading', percent }));
      this.set(ready ? { state: 'downloaded', percent: 100 } : { state: 'error', error: 'Tải không thành công' });
    } catch (e) {
      this.set({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  async apply(): Promise<void> {
    await this.adapter.apply();
  }
}

/** Dùng trên nền tảng không hỗ trợ update (vd Linux dev) — luôn báo không có bản mới. */
export class NullUpdater implements UpdaterAdapter {
  readonly canAutoInstall = false;
  async check() { return { available: false, latest: null }; }
  async start() { return { ready: false }; }
  async apply() { /* no-op */ }
}
