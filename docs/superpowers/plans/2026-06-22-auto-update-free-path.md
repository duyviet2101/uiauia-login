# Auto-update (Free Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép app tự kiểm tra + tải bản mới — Windows cài tự động (electron-updater), macOS tự tải DMG rồi mở trình cài đặt — không cần ký số.

**Architecture:** Một `UpdateService` ở main process rẽ nhánh theo `process.platform`, gọi một `UpdaterAdapter` (WinUpdater dùng electron-updater; MacUpdater dùng GitHub API + tải dmg + `shell.openPath`), và đẩy `UpdateStatus` ra renderer qua `webContents.send`. Renderer khởi xướng check lúc mount + nút thủ công; banner hiển thị theo state.

**Tech Stack:** Electron 42, electron-vite, electron-builder 26, `electron-updater` (mới), React + Tailwind, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-22-auto-update-free-path-design.md`

> **Môi trường:** mọi lệnh chạy với **Node ≥ 20** (`nvm use 20` trước; toolchain repo cần). Test 1 file: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit -p tsconfig.json`.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/main/semver.ts` (mới) | `parseSemver`, `isNewer` — thuần, không phụ thuộc electron (để test + dùng chung). |
| `src/main/mac-updater.ts` (mới) | `pickDmgAsset` + `MacUpdater` (check GitHub, tải dmg, mở installer). |
| `src/main/win-updater.ts` (mới) | `WinUpdater` — adapter mỏng quanh electron-updater `autoUpdater`. |
| `src/main/update-service.ts` (mới) | `UpdateService` (orchestrator + state + broadcast) + `NullUpdater`. |
| `src/main/types.ts` (sửa) | thêm `UpdateState`, `UpdateStatus`, `UpdaterAdapter`, `GithubAsset`; bỏ `UpdateInfo` (Task 11). |
| `src/main/index.ts` (sửa) | khởi tạo `UpdateService` + handler `update:*`; dọn `app:check-update` (Task 11). |
| `src/preload/preload.ts`, `src/renderer/api.ts` (sửa) | thêm `update.*` + `onStatus`; dọn `checkUpdate` (Task 11). |
| `src/renderer/components/UpdateBanner.tsx`, `src/renderer/App.tsx` (sửa) | banner có trạng thái + nối API mới. |
| `src/main/updater.ts` | XOÁ ở Task 11 (bị thay thế). |
| `.github/workflows/release.yml` (sửa) | publish `latest*.yml`, `*.blockmap`, `*.zip`. |

---

## Task 1: Thêm dependency electron-updater

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Cài đặt (runtime dependency, không phải dev)**

Run: `npm install electron-updater`
Expected: `package.json` `dependencies` có `"electron-updater": "^6...."`.

- [ ] **Step 2: Xác nhận nằm đúng chỗ**

Run: `node -e "console.log(require('./package.json').dependencies['electron-updater'])"`
Expected: in ra version (vd `^6.6.2`), không phải `undefined`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(update): add electron-updater dependency"
```

---

## Task 2: Helper semver thuần + kiểu dữ liệu update

**Files:**
- Create: `src/main/semver.ts`
- Test: `tests/semver.test.ts`
- Modify: `src/main/types.ts`

- [ ] **Step 1: Viết test thất bại**

Create `tests/semver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isNewer } from '../src/main/semver';

describe('isNewer', () => {
  it('true khi latest cao hơn', () => {
    expect(isNewer('v0.3.0', '0.2.2')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });
  it('false khi bằng hoặc thấp hơn', () => {
    expect(isNewer('0.2.2', '0.2.2')).toBe(false);
    expect(isNewer('v0.2.1', '0.2.2')).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `npx vitest run tests/semver.test.ts`
Expected: FAIL — `Cannot find module '../src/main/semver'`.

- [ ] **Step 3: Tạo `src/main/semver.ts`**

```ts
/** Parse "v1.2.3" -> [1,2,3]; phần thiếu/không hợp lệ -> 0. */
export function parseSemver(v: string): number[] {
  return v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** True khi `latest` là semver lớn hơn hẳn `current`. */
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
```

- [ ] **Step 4: Chạy test — phải PASS**

Run: `npx vitest run tests/semver.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Thêm kiểu vào `src/main/types.ts`** (thêm vào cuối file)

```ts
export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  platform: 'win32' | 'darwin' | 'other';
  current: string;
  latest: string | null;
  percent?: number;
  canAutoInstall: boolean;
  error?: string;
}

export interface UpdaterAdapter {
  /** Win = true (cài & relaunch); Mac = false (chỉ mở installer). */
  readonly canAutoInstall: boolean;
  check(current: string): Promise<{ available: boolean; latest: string | null }>;
  start(onProgress: (percent: number) => void): Promise<{ ready: boolean; artifactPath?: string }>;
  apply(): Promise<void>;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi.

```bash
git add src/main/semver.ts tests/semver.test.ts src/main/types.ts
git commit -m "feat(update): add semver helper + update status/adapter types"
```

---

## Task 3: pickDmgAsset (chọn DMG theo arch)

**Files:**
- Create: `src/main/mac-updater.ts`
- Test: `tests/mac-updater.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `tests/mac-updater.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickDmgAsset } from '../src/main/mac-updater';
import type { GithubAsset } from '../src/main/types';

const a = (name: string): GithubAsset => ({ name, browser_download_url: `https://x/${name}` });

describe('pickDmgAsset', () => {
  const dmgs = [a('App-1.0.0-arm64.dmg'), a('App-1.0.0-x64.dmg'), a('App-1.0.0.exe')];
  it('chọn arm64 trên máy arm64', () => {
    expect(pickDmgAsset(dmgs, 'arm64')?.name).toBe('App-1.0.0-arm64.dmg');
  });
  it('chọn x64 trên máy x64', () => {
    expect(pickDmgAsset(dmgs, 'x64')?.name).toBe('App-1.0.0-x64.dmg');
  });
  it('null khi không có dmg', () => {
    expect(pickDmgAsset([a('App.exe'), a('latest.yml')], 'arm64')).toBeNull();
  });
  it('fallback dmg không có hậu tố arch', () => {
    expect(pickDmgAsset([a('App-1.0.0.dmg')], 'x64')?.name).toBe('App-1.0.0.dmg');
  });
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: FAIL — `Cannot find module '../src/main/mac-updater'`.

- [ ] **Step 3: Tạo `src/main/mac-updater.ts`**

```ts
import type { GithubAsset } from './types';

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
```

- [ ] **Step 4: Chạy test — phải PASS**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/mac-updater.ts tests/mac-updater.test.ts
git commit -m "feat(update): pickDmgAsset selects dmg by cpu arch"
```

---

## Task 4: MacUpdater.check (GitHub API)

**Files:**
- Modify: `src/main/mac-updater.ts`
- Test: `tests/mac-updater.test.ts`

- [ ] **Step 1: Thêm test thất bại** (thêm vào `tests/mac-updater.test.ts`)

```ts
import { MacUpdater } from '../src/main/mac-updater';

describe('MacUpdater.check', () => {
  const release = JSON.stringify({
    tag_name: 'v9.9.9', html_url: 'https://h',
    assets: [{ name: 'App-9.9.9-arm64.dmg', browser_download_url: 'https://x/arm.dmg' }],
  });
  it('available + lưu url dmg khi có bản mới', async () => {
    const fetcher = async () => new Response(release, { status: 200 });
    const u = new MacUpdater('o/r', { arch: 'arm64', fetcher: fetcher as typeof fetch });
    const r = await u.check('0.2.2');
    expect(r.available).toBe(true);
    expect(r.latest).toBe('v9.9.9');
    expect(u.downloadUrl).toBe('https://x/arm.dmg');
  });
  it('không available khi đang là bản mới nhất', async () => {
    const fetcher = async () => new Response(JSON.stringify({ tag_name: 'v0.2.2', assets: [] }), { status: 200 });
    const u = new MacUpdater('o/r', { fetcher: fetcher as typeof fetch });
    expect((await u.check('0.2.2')).available).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy — phải FAIL**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: FAIL — `MacUpdater is not a constructor` / không export.

- [ ] **Step 3: Thêm class vào `src/main/mac-updater.ts`** (dưới `pickDmgAsset`)

```ts
import { isNewer } from './semver';
import type { UpdaterAdapter } from './types';

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
}
```

- [ ] **Step 4: Chạy — phải PASS**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: PASS (toàn bộ pickDmgAsset + check).

- [ ] **Step 5: Commit**

```bash
git add src/main/mac-updater.ts tests/mac-updater.test.ts
git commit -m "feat(update): MacUpdater.check via GitHub releases API"
```

---

## Task 5: MacUpdater.start (tải dmg) + apply (mở installer)

**Files:**
- Modify: `src/main/mac-updater.ts`
- Test: `tests/mac-updater.test.ts`

- [ ] **Step 1: Thêm test thất bại** (thêm vào `tests/mac-updater.test.ts`)

```ts
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('MacUpdater.start + apply', () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);
  const fetcher = (async (url: string | URL) => {
    if (String(url).includes('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: 'v9.9.9',
        assets: [{ name: 'App-9.9.9-arm64.dmg', browser_download_url: 'https://x/arm.dmg' }],
      }), { status: 200 });
    }
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  }) as typeof fetch;

  it('tải dmg ra đĩa + báo % rồi apply mở đúng file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mu-'));
    const opened: string[] = [];
    const u = new MacUpdater('o/r', {
      arch: 'arm64', fetcher, tmpDir: () => dir,
      openPath: async (p) => { opened.push(p); return ''; },
    });
    const pct: number[] = [];
    await u.check('0.0.1');
    const r = await u.start((p) => pct.push(p));
    expect(r.ready).toBe(true);
    expect(readFileSync(r.artifactPath!)).toEqual(Buffer.from(bytes));
    expect(pct.at(-1)).toBe(100);
    await u.apply();
    expect(opened).toEqual([r.artifactPath]);
  });
});
```

- [ ] **Step 2: Chạy — phải FAIL**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: FAIL — `u.start is not a function`.

- [ ] **Step 3: Thêm import + method vào `src/main/mac-updater.ts`**

Thêm import (đầu file, cùng nhóm import):

```ts
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
```

Thêm 2 method + 2 helper vào trong class `MacUpdater`:

```ts
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
```

- [ ] **Step 4: Chạy — phải PASS**

Run: `npx vitest run tests/mac-updater.test.ts`
Expected: PASS (tất cả).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi.

```bash
git add src/main/mac-updater.ts tests/mac-updater.test.ts
git commit -m "feat(update): MacUpdater downloads dmg with progress + opens installer"
```

---

## Task 6: WinUpdater (adapter electron-updater)

**Files:**
- Create: `src/main/win-updater.ts`
- Test: `tests/win-updater.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `tests/win-updater.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { WinUpdater } from '../src/main/win-updater';

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
});
```

- [ ] **Step 2: Chạy — phải FAIL**

Run: `npx vitest run tests/win-updater.test.ts`
Expected: FAIL — `Cannot find module '../src/main/win-updater'`.

- [ ] **Step 3: Tạo `src/main/win-updater.ts`**

```ts
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

export class WinUpdater implements UpdaterAdapter {
  readonly canAutoInstall = true;
  private latest: string | null = null;
  private onProgress: ((p: number) => void) | null = null;
  private resolveDownloaded: ((r: { ready: boolean }) => void) | null = null;

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
    this.onProgress = onProgress;
    const done = new Promise<{ ready: boolean }>((resolve) => { this.resolveDownloaded = resolve; });
    await this.au.downloadUpdate();
    return done;
  }

  async apply(): Promise<void> {
    this.au.quitAndInstall();
  }
}
```

- [ ] **Step 4: Chạy — phải PASS**

Run: `npx vitest run tests/win-updater.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/win-updater.ts tests/win-updater.test.ts
git commit -m "feat(update): WinUpdater adapter over electron-updater"
```

---

## Task 7: UpdateService + NullUpdater (orchestrator)

**Files:**
- Create: `src/main/update-service.ts`
- Test: `tests/update-service.test.ts`

- [ ] **Step 1: Viết test thất bại**

Create `tests/update-service.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Chạy — phải FAIL**

Run: `npx vitest run tests/update-service.test.ts`
Expected: FAIL — `Cannot find module '../src/main/update-service'`.

- [ ] **Step 3: Tạo `src/main/update-service.ts`**

```ts
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
```

- [ ] **Step 4: Chạy — phải PASS**

Run: `npx vitest run tests/update-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/update-service.ts tests/update-service.test.ts
git commit -m "feat(update): UpdateService orchestrator + NullUpdater"
```

---

## Task 8: Nối vào main process (giữ đường cũ song song)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Thêm import** (cạnh các import hiện có ở đầu `src/main/index.ts`)

```ts
import { UpdateService, NullUpdater } from './update-service';
import { MacUpdater } from './mac-updater';
import { WinUpdater } from './win-updater';
import type { UpdaterAdapter, UpdateStatus } from './types';
```

- [ ] **Step 2: Khởi tạo UpdateService + handler** — trong `app.whenReady().then(...)`, **bên trong khối `try`, ngay trước** dòng `setInitState({ phase: 'ready', message: '' });`:

```ts
    const updateRepo = 'duyviet2101/uiauia-login';
    const plat: UpdateStatus['platform'] =
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'other';
    let updateAdapter: UpdaterAdapter;
    if (plat === 'win32') {
      const { autoUpdater } = await import('electron-updater');
      updateAdapter = new WinUpdater(autoUpdater as unknown as ConstructorParameters<typeof WinUpdater>[0]);
    } else if (plat === 'darwin') {
      updateAdapter = new MacUpdater(updateRepo);
    } else {
      updateAdapter = new NullUpdater();
    }
    const updateService = new UpdateService(updateAdapter, app.getVersion(), plat, (status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:status', status);
      }
    });
    ipcMain.handle('update:check', () => updateService.check());
    ipcMain.handle('update:start', () => updateService.start());
    ipcMain.handle('update:apply', () => updateService.apply());
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi.

- [ ] **Step 4: Build main bundle (electron-vite) — đảm bảo bundle được**

Run: `npx electron-vite build`
Expected: build thành công (main/preload/renderer), không lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(update): wire UpdateService + update:* IPC in main"
```

---

## Task 9: Bridge preload + api (thêm update.*, giữ checkUpdate cũ)

**Files:**
- Modify: `src/preload/preload.ts`, `src/renderer/api.ts`

- [ ] **Step 1: `src/preload/preload.ts`** — thêm `UpdateStatus` vào import type và thêm khối `update` vào object `api` (ngay sau `openExternal`):

Sửa dòng import:

```ts
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, InitState, UpdateInfo, UpdateStatus } from '../main/types';
```

Thêm vào object `api`:

```ts
  update: {
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    start: (): Promise<void> => ipcRenderer.invoke('update:start'),
    apply: (): Promise<void> => ipcRenderer.invoke('update:apply'),
    onStatus: (cb: (s: UpdateStatus) => void) => {
      const handler = (_e: unknown, s: UpdateStatus) => cb(s);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },
```

- [ ] **Step 2: `src/renderer/api.ts`** — thêm `UpdateStatus` vào import type và thêm wrapper `update` (sau `openExternal`):

Sửa import (thêm `UpdateStatus` vào danh sách):

```ts
  UpdateStatus,
```

Thêm vào object `api`:

```ts
  update: {
    check: (): Promise<UpdateStatus> => need().update.check(),
    start: (): Promise<void> => need().update.start(),
    apply: (): Promise<void> => need().update.apply(),
    onStatus: (cb: (s: UpdateStatus) => void) => need().update.onStatus(cb),
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi (`Window.api` tự suy ra `Api` từ preload nên `global.d.ts` không cần sửa).

- [ ] **Step 4: Commit**

```bash
git add src/preload/preload.ts src/renderer/api.ts
git commit -m "feat(update): expose update.* over contextBridge"
```

---

## Task 10: Banner có trạng thái + nối App.tsx sang API mới

**Files:**
- Modify: `src/renderer/components/UpdateBanner.tsx`, `src/renderer/App.tsx`

- [ ] **Step 1: Viết lại `src/renderer/components/UpdateBanner.tsx`** (toàn bộ file)

```tsx
import type { UpdateStatus } from '../../main/types';

interface Props {
  status: UpdateStatus;
  onStart: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

const BTN = 'rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors';

export function UpdateBanner({ status, onStart, onApply, onDismiss }: Props) {
  const { state, latest, current, percent, canAutoInstall, error } = status;

  let body: React.ReactNode = null;
  let action: React.ReactNode = null;

  if (state === 'available') {
    body = <>Có bản mới <strong>{latest}</strong> (đang dùng {current}).</>;
    action = <button onClick={onStart} className={BTN}>Tải về</button>;
  } else if (state === 'downloading') {
    body = <>Đang tải bản mới… <strong>{percent ?? 0}%</strong></>;
  } else if (state === 'downloaded') {
    body = canAutoInstall
      ? <>Đã tải xong. Cài đè lên app cũ — dữ liệu giữ nguyên.</>
      : <>Đã tải xong. Mở trình cài đặt rồi kéo app vào thư mục Applications.</>;
    action = <button onClick={onApply} className={BTN}>{canAutoInstall ? 'Cài & khởi động lại' : 'Mở trình cài đặt'}</button>;
  } else if (state === 'error') {
    body = <>Không cập nhật được: {error}</>;
  } else {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-700 bg-blue-950/70 px-4 py-2.5 text-sm text-blue-100">
      <span className="text-lg">🎉</span>
      <span className="flex-1">{body}</span>
      {action}
      <button onClick={onDismiss} className="text-blue-300/70 hover:text-blue-100 transition-colors" aria-label="Đóng">✕</button>
    </div>
  );
}
```

- [ ] **Step 2: `src/renderer/App.tsx` — đổi import type** (dòng 2): thay `UpdateInfo` bằng `UpdateStatus`:

```ts
import type { ProfileRuntime, ProxyWarning, InitState, UpdateStatus, IdentityDrift } from '../main/types';
```

- [ ] **Step 3: Đổi state** (dòng ~30):

```ts
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
```

- [ ] **Step 4: Thay lời gọi check** — xoá dòng cũ `api.checkUpdate().then(setUpdate).catch(() => {});` (dòng ~72) và thêm `useEffect` riêng (đặt cạnh các effect khác trong component):

```ts
  useEffect(() => {
    const off = api.update.onStatus(setUpdate);
    api.update.check().catch(() => {});
    return off;
  }, []);
```

- [ ] **Step 5: Thay phần render banner** (dòng ~213-218) bằng:

```tsx
        {update && !updateDismissed && ['available', 'downloading', 'downloaded', 'error'].includes(update.state) && (
          <UpdateBanner
            status={update}
            onStart={() => { void api.update.start(); }}
            onApply={() => { void api.update.apply(); }}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi. (Nếu báo `useEffect` thiếu import — `App.tsx` đã dùng `useEffect` sẵn nên không cần thêm.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/UpdateBanner.tsx src/renderer/App.tsx
git commit -m "feat(update): stateful update banner wired to update.* API"
```

---

## Task 11: Dọn đường cũ (xoá checkUpdate / updater.ts / UpdateInfo)

**Files:**
- Modify: `src/main/index.ts`, `src/preload/preload.ts`, `src/renderer/api.ts`, `src/main/types.ts`
- Delete: `src/main/updater.ts`

- [ ] **Step 1: `src/main/index.ts`** — xoá import + handler cũ:
  - Xoá dòng `import { checkForUpdate } from './updater';`
  - Xoá dòng `ipcMain.handle('app:check-update', () => checkForUpdate());`

- [ ] **Step 2: `src/preload/preload.ts`** — xoá dòng `checkUpdate: ...` và bỏ `UpdateInfo` khỏi import type.

- [ ] **Step 3: `src/renderer/api.ts`** — xoá dòng `checkUpdate: ...` và bỏ `UpdateInfo` khỏi import type.

- [ ] **Step 4: `src/main/types.ts`** — xoá `interface UpdateInfo { ... }` (không còn ai dùng).

- [ ] **Step 5: Xoá file cũ**

Run: `git rm src/main/updater.ts`
Expected: file bị xoá (logic `isNewer` đã chuyển sang `semver.ts`; `checkForUpdate` đã được thay).

- [ ] **Step 6: Typecheck — bắt mọi tham chiếu còn sót**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi. (Nếu lỗi "Cannot find name 'UpdateInfo'/'checkUpdate'" → còn chỗ tham chiếu, sửa nốt.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(update): remove legacy check-update path + updater.ts"
```

---

## Task 12: CI publish metadata cho updater

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Mở rộng glob upload-artifact** — trong job `build`, đổi khối `path:` của bước `actions/upload-artifact@v4` từ:

```yaml
          path: |
            dist/*.dmg
            dist/*.exe
          if-no-files-found: ignore
```

thành:

```yaml
          path: |
            dist/*.dmg
            dist/*.exe
            dist/*.zip
            dist/*.blockmap
            dist/latest*.yml
          if-no-files-found: ignore
```

- [ ] **Step 2: Sanity YAML** (kiểm tra cú pháp)

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); if(!y.includes('latest*.yml')) throw new Error('glob chưa thêm'); console.log('ok')"`
Expected: in `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(update): publish latest.yml/zip/blockmap for auto-update feed"
```

---

## Task 13: Kiểm thử tổng + ghi chú verify thật

**Files:** không sửa code.

- [ ] **Step 1: Chạy toàn bộ test**

Run: `npx vitest run`
Expected: tất cả PASS (65 cũ + semver 2 + mac-updater ~7 + win-updater 4 + update-service 5).

- [ ] **Step 2: Typecheck toàn dự án**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: không lỗi.

- [ ] **Step 3: Build đóng gói thử (tùy chọn, cục bộ)**

Run: `npx electron-vite build`
Expected: build OK.

- [ ] **Step 4: Ghi chú verify đầu-cuối THẬT (cần người dùng)**

electron-updater chỉ chạy khi app **đã đóng gói + có release publish `latest.yml`**. Quy trình verify:
1. Bump `version` trong `package.json` (vd `0.2.3`), commit, tag `v0.2.3`, push → CI publish (giờ kèm `latest.yml`).
2. Cài bản `v0.2.3` lên máy (Win) / kéo-thả (Mac) — **lần này vẫn thủ công** (bản nguồn chưa có updater).
3. Bump `0.2.4`, tag `v0.2.4`, push → CI publish.
4. Mở app `v0.2.3`: Windows phải hiện "Có bản mới 0.2.4 → Tải → Cài & khởi động lại"; macOS phải tự tải DMG rồi "Mở trình cài đặt".

- [ ] **Step 5: Commit (nếu có thay đổi version cho lần verify) — để người dùng quyết định**

Không tự ý bump/tag. Hỏi người dùng trước khi cắt release thử.

---

## Self-Review (đã thực hiện khi viết plan)

- **Spec coverage:** Win auto-update (Task 6,8) ✓; Mac download+open (Task 3,4,5,8) ✓; check-on-mount + nút thủ công (Task 10) ✓; banner trạng thái (Task 10) ✓; IPC contract update:check/start/apply + onStatus (Task 8,9) ✓; CI publish latest.yml/zip/blockmap (Task 12) ✓; error fallback (MacUpdater htmlUrl, UpdateService error state) ✓; NullUpdater cho 'other' (Task 7) ✓; giới hạn first-jump + e2e (Task 13) ✓.
- **Placeholder scan:** không có TODO/“xử lý lỗi phù hợp”; mọi step có code/lệnh cụ thể.
- **Type consistency:** `UpdaterAdapter.check/start/apply/canAutoInstall`, `UpdateStatus` fields, `UpdateService.check/start/apply`, `MacUpdater.downloadUrl`, `pickDmgAsset(assets,arch)`, `WinUpdater(au)`, `isNewer(latest,current)` — dùng nhất quán xuyên suốt các task.
