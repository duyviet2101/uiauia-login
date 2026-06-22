import { describe, it, expect } from 'vitest';
import { UpdateService } from '../src/main/update-service';
import type { UpdateStatus, UpdaterAdapter } from '../src/main/types';

class FakeAdapter implements UpdaterAdapter {
  readonly canAutoInstall = true;
  applied = false;
  constructor(private avail: boolean, private latestV: string | null, private throwOnCheck = false) {}
  async check() {
    if (this.throwOnCheck) throw new Error('net down');
    return { available: this.avail, latest: this.latestV };
  }
  async start(onProgress: (n: number) => void) { onProgress(50); return { ready: true }; }
  async apply() { this.applied = true; }
}

const sink = () => { const sent: UpdateStatus[] = []; return { sent, push: (s: UpdateStatus) => sent.push({ ...s }) }; };

describe('UpdateService', () => {
  it('check: checking -> available, kèm latest + canAutoInstall', async () => {
    const s = sink();
    const svc = new UpdateService(new FakeAdapter(true, '9.9.9'), '0.2.2', 'win32', s.push);
    const final = await svc.check();
    expect(s.sent.map((x) => x.state)).toEqual(['checking', 'available']);
    expect(final.latest).toBe('9.9.9');
    expect(final.canAutoInstall).toBe(true);
  });
  it('check: checking -> up-to-date', async () => {
    const s = sink();
    const svc = new UpdateService(new FakeAdapter(false, '0.2.2'), '0.2.2', 'darwin', s.push);
    await svc.check();
    expect(s.sent.map((x) => x.state)).toEqual(['checking', 'up-to-date']);
  });
  it('check: lỗi -> error + message', async () => {
    const s = sink();
    const svc = new UpdateService(new FakeAdapter(true, null, true), '0.2.2', 'win32', s.push);
    await svc.check();
    const last = s.sent.at(-1)!;
    expect(last.state).toBe('error');
    expect(last.error).toContain('net down');
  });
  it('start: downloading(%) -> downloaded', async () => {
    const s = sink();
    const svc = new UpdateService(new FakeAdapter(true, '9.9.9'), '0.2.2', 'win32', s.push);
    await svc.start();
    expect(s.sent.map((x) => x.state)).toEqual(['downloading', 'downloading', 'downloaded']);
    expect(s.sent.map((x) => x.percent)).toEqual([0, 50, 100]);
  });
  it('apply: uỷ quyền cho adapter', async () => {
    const adapter = new FakeAdapter(true, '9.9.9');
    const svc = new UpdateService(adapter, '0.2.2', 'win32', () => {});
    await svc.apply();
    expect(adapter.applied).toBe(true);
  });
  it('start: adapter ready=false -> error', async () => {
    const adapter: UpdaterAdapter = {
      canAutoInstall: false,
      async check() { return { available: true, latest: '9.9.9' }; },
      async start() { return { ready: false }; },
      async apply() {},
    };
    const s = sink();
    const svc = new UpdateService(adapter, '0.2.2', 'darwin', s.push);
    await svc.start();
    expect(s.sent.at(-1)!.state).toBe('error');
  });
});
