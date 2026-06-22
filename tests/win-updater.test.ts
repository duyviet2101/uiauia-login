import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { WinUpdater, resolveElectronAutoUpdater } from '../src/main/win-updater';

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  downloads = 0;
  quit = 0;
  result: unknown = { updateInfo: { version: '9.9.9' } };
  async checkForUpdates() { return this.result; }
  async downloadUpdate() { this.downloads++; return []; }
  quitAndInstall() { this.quit++; }
}

describe('WinUpdater', () => {
  it('resolveElectronAutoUpdater đọc named export', () => {
    const au = new FakeAutoUpdater();
    expect(resolveElectronAutoUpdater({ autoUpdater: au })).toBe(au);
  });
  it('resolveElectronAutoUpdater đọc default export của dynamic import ESM', () => {
    const au = new FakeAutoUpdater();
    expect(resolveElectronAutoUpdater({ default: { autoUpdater: au } })).toBe(au);
  });
  it('resolveElectronAutoUpdater báo lỗi rõ khi thiếu autoUpdater', () => {
    expect(() => resolveElectronAutoUpdater({ default: {} })).toThrow('autoUpdater export was not found');
  });
  it('tắt autoDownload khi khởi tạo', () => {
    const au = new FakeAutoUpdater();
    new WinUpdater(au as never);
    expect(au.autoDownload).toBe(false);
    expect(au.autoInstallOnAppQuit).toBe(false);
  });
  it('check trả available cho bản mới', async () => {
    const w = new WinUpdater(new FakeAutoUpdater() as never);
    const r = await w.check('0.2.2');
    expect(r.available).toBe(true);
    expect(r.latest).toBe('9.9.9');
  });
  it('start báo % và resolve khi update-downloaded', async () => {
    const au = new FakeAutoUpdater();
    const w = new WinUpdater(au as never);
    const pct: number[] = [];
    const p = w.start((x) => pct.push(x));
    au.emit('download-progress', { percent: 42.6 });
    au.emit('update-downloaded', {});
    const r = await p;
    expect(r.ready).toBe(true);
    expect(au.downloads).toBe(1);
    expect(pct).toContain(43);
  });
  it('apply gọi quitAndInstall', async () => {
    const au = new FakeAutoUpdater();
    await new WinUpdater(au as never).apply();
    expect(au.quit).toBe(1);
  });
  it('start gọi 2 lần chỉ tải 1 lần', async () => {
    const au = new FakeAutoUpdater();
    const w = new WinUpdater(au as never);
    const p1 = w.start(() => {});
    const p2 = w.start(() => {});
    au.emit('update-downloaded', {});
    await Promise.all([p1, p2]);
    expect(au.downloads).toBe(1);
  });
});
