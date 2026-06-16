# Anti-Detect Browser Profile Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một app desktop Electron đóng gói được (`.exe`/`.dmg`) để tạo/quản lý/mở nhiều profile Chrome anti-detect, mỗi profile là một danh tính + IP riêng sao cho các nền tảng không liên kết được chúng về cùng một máy nguồn.

**Architecture:** Electron thuần. Main process (Node) sở hữu toàn bộ logic (lowdb store, browser manager gọi `cloakbrowser`, proxy tester, fingerprint probe) và đẩy ra renderer qua IPC có kiểu. Renderer React+Vite+Tailwind cách ly hoàn toàn. Cửa sổ Chrome là process OS độc lập do binary CloakBrowser bật ra, user thao tác tay.

**Tech Stack:** TypeScript, electron-vite, Electron, React, Tailwind, `cloakbrowser` + `playwright-core`, lowdb (JSON), Vitest, electron-builder.

**Spec:** `docs/superpowers/specs/2026-06-17-antidetect-browser-manager-design.md`

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, `electron-builder.yml` | Scaffold & build |
| `src/main/types.ts` | Các interface dùng chung (Profile, ProxyConfig, Fingerprint...) |
| `src/main/launch-args.ts` | `toProxyUrl`, `buildLaunchArgs` — trái tim anti-detect (pure) |
| `src/main/unlinkability.ts` | `findProxyConflicts`, `proxyWarnings` (pure) |
| `src/main/store.ts` | `ProfileStore` (lowdb, CRUD, sinh seed/userDataDir) |
| `src/main/fingerprint-probe.ts` | `parseFingerprint` (pure) + `captureFingerprint` (wrapper) |
| `src/main/browser-manager.ts` | `BrowserManager` (launch/stop/track, EventEmitter status) |
| `src/main/proxy-tester.ts` | `ProxyTester.test` |
| `src/main/quarantine.ts` | `clearQuarantine` (macOS xattr trên binary) |
| `src/main/ipc.ts` | Đăng ký IPC handlers → service methods |
| `src/main/index.ts` | App lifecycle, BrowserWindow, ensureBinary, wiring |
| `src/preload/preload.ts` | contextBridge → `window.api` |
| `src/renderer/api.ts` | Typed wrapper quanh `window.api` |
| `src/renderer/App.tsx` + `components/*` | UI: ProfileList, ProfileForm, FingerprintPanel, ProxyTestButton, Warnings |
| `tests/**` | Vitest unit + integration |

---

## Task 1: Scaffold project

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `src/main/index.ts` (stub), `src/preload/preload.ts` (stub), `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx` (stub), `src/renderer/index.css`

- [ ] **Step 1: Init npm + install deps**

Run:
```bash
cd /Users/duyviet/workspaces/login-anti-detect/uiauia-login
npm init -y
npm i cloakbrowser playwright-core lowdb
npm i -D electron electron-vite electron-builder vite typescript \
  @types/node react react-dom @types/react @types/react-dom @vitejs/plugin-react \
  tailwindcss postcss autoprefixer vitest
```
Expected: installs without error; `node_modules/` populated.

- [ ] **Step 2: Write `package.json` scripts + type**

Merge into `package.json`:
```json
{
  "name": "uiauia-login",
  "version": "0.1.0",
  "description": "Anti-detect Chrome profile manager",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "dist": "electron-vite build && electron-builder",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [react()],
  },
});
```

- [ ] **Step 4: Write `tsconfig.json` + `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```
`tsconfig.node.json` (referenced by electron-vite): same as above minus `jsx`.

- [ ] **Step 5: Tailwind config + css**

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```
`postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```
`src/renderer/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Stub main/preload/renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```
`src/preload/preload.ts`:
```ts
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('api', {});
```
`src/renderer/index.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>uiauia-login</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```
`src/renderer/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
```
`src/renderer/App.tsx`:
```tsx
export default function App() {
  return <div className="p-6 text-lg font-semibold">uiauia-login</div>;
}
```

- [ ] **Step 7: Verify dev build launches**

Run: `npm run dev`
Expected: Electron window mở, hiện "uiauia-login". Đóng cửa sổ để thoát.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold electron-vite + react app"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/main/types.ts`

- [ ] **Step 1: Write the types**

```ts
export interface ProxyConfig {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface Fingerprint {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  languages: string[];
  screen: { width: number; height: number; colorDepth: number };
  devicePixelRatio: number;
  webglVendor: string | null;
  webglRenderer: string | null;
  timezone: string;
  webdriver: boolean;
  capturedAt: string;
}

export interface Profile {
  id: string;
  name: string;
  seed: number;
  proxy: ProxyConfig | null;
  geoip: boolean;
  timezone: string | null;
  locale: string | null;
  userDataDir: string;
  fingerprint: Fingerprint | null;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface CreateProfileInput {
  name: string;
  proxy?: ProxyConfig | null;
  geoip?: boolean;
  timezone?: string | null;
  locale?: string | null;
}

export type UpdateProfileInput = Partial<Omit<Profile, 'id' | 'seed' | 'userDataDir' | 'createdAt'>>;

export interface ProxyTestResult {
  ok: boolean;
  ip?: string;
  country?: string;
  latencyMs?: number;
  error?: string;
}

export interface ProfileRuntime extends Profile {
  running: boolean;
}

export interface ProxyWarning {
  profileId: string;
  level: 'high' | 'medium';
  message: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/types.ts && git commit -m "feat: shared domain types"
```

---

## Task 3: launch-args (trái tim anti-detect)

**Files:**
- Create: `src/main/launch-args.ts`
- Test: `tests/launch-args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toProxyUrl, buildLaunchArgs } from '../src/main/launch-args';
import type { Profile } from '../src/main/types';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'A', seed: 12345, proxy: null, geoip: true,
    timezone: null, locale: null, userDataDir: '/data/p1',
    fingerprint: null, createdAt: '', lastOpenedAt: null, ...over,
  };
}

describe('toProxyUrl', () => {
  it('http without auth', () => {
    expect(toProxyUrl({ type: 'http', host: '1.2.3.4', port: 8080 }))
      .toBe('http://1.2.3.4:8080');
  });
  it('socks5 with auth, url-encodes credentials', () => {
    expect(toProxyUrl({ type: 'socks5', host: 'h', port: 1080, username: 'u@x', password: 'p:y' }))
      .toBe('socks5://u%40x:p%3Ay@h:1080');
  });
});

describe('buildLaunchArgs', () => {
  it('always headed with fingerprint seed', () => {
    const o = buildLaunchArgs(profile());
    expect(o.headless).toBe(false);
    expect(o.userDataDir).toBe('/data/p1');
    expect(o.args).toContain('--fingerprint=12345');
  });
  it('no proxy => no geoip, no webrtc flag', () => {
    const o = buildLaunchArgs(profile({ proxy: null }));
    expect(o.proxy).toBeUndefined();
    expect(o.geoip).toBe(false);
    expect(o.args).not.toContain('--fingerprint-webrtc-ip=auto');
  });
  it('proxy + geoip on => geoip true, no manual webrtc flag (geoip auto-injects)', () => {
    const o = buildLaunchArgs(profile({ proxy: { type: 'http', host: 'h', port: 80 }, geoip: true }));
    expect(o.geoip).toBe(true);
    expect(o.args).not.toContain('--fingerprint-webrtc-ip=auto');
  });
  it('proxy + geoip off => add manual webrtc flag', () => {
    const o = buildLaunchArgs(profile({ proxy: { type: 'http', host: 'h', port: 80 }, geoip: false }));
    expect(o.geoip).toBe(false);
    expect(o.args).toContain('--fingerprint-webrtc-ip=auto');
  });
  it('manual timezone/locale override pass through', () => {
    const o = buildLaunchArgs(profile({ timezone: 'Asia/Tokyo', locale: 'ja-JP' }));
    expect(o.timezone).toBe('Asia/Tokyo');
    expect(o.locale).toBe('ja-JP');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/launch-args.test.ts`
Expected: FAIL — cannot find module `launch-args`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Profile, ProxyConfig } from './types';

export function toProxyUrl(p: ProxyConfig): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${p.type}://${auth}${p.host}:${p.port}`;
}

export function buildLaunchArgs(p: Profile): LaunchPersistentContextOptions {
  const args = [`--fingerprint=${p.seed}`];
  // geoip=true tự inject --fingerprint-webrtc-ip; chỉ thêm tay khi proxy mà geoip tắt.
  if (p.proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,
    proxy: p.proxy ? toProxyUrl(p.proxy) : undefined,
    geoip: p.proxy ? p.geoip : false,
    timezone: p.timezone ?? undefined,
    locale: p.locale ?? undefined,
    args,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/launch-args.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/launch-args.ts tests/launch-args.test.ts
git commit -m "feat: launch-args anti-detect option builder"
```

---

## Task 4: unlinkability helpers

**Files:**
- Create: `src/main/unlinkability.ts`
- Test: `tests/unlinkability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { findProxyConflicts, proxyWarnings } from '../src/main/unlinkability';
import type { Profile } from '../src/main/types';

function profile(id: string, host: string | null, port = 8080): Profile {
  return {
    id, name: id, seed: 1, geoip: true, timezone: null, locale: null,
    userDataDir: '/d/' + id, fingerprint: null, createdAt: '', lastOpenedAt: null,
    proxy: host ? { type: 'http', host, port } : null,
  };
}

describe('findProxyConflicts', () => {
  it('returns ids sharing same host:port', () => {
    const profiles = [profile('a', '1.1.1.1'), profile('b', '1.1.1.1'), profile('c', '2.2.2.2')];
    expect(findProxyConflicts(profiles)).toEqual([['a', 'b']]);
  });
  it('no conflicts => empty', () => {
    expect(findProxyConflicts([profile('a', '1.1.1.1'), profile('b', '2.2.2.2')])).toEqual([]);
  });
});

describe('proxyWarnings', () => {
  it('flags no-proxy profile as high risk', () => {
    const w = proxyWarnings([profile('a', null)]);
    expect(w).toContainEqual({ profileId: 'a', level: 'high', message: expect.stringContaining('proxy') });
  });
  it('flags duplicated proxy host as medium', () => {
    const w = proxyWarnings([profile('a', '1.1.1.1'), profile('b', '1.1.1.1')]);
    expect(w.filter((x) => x.level === 'medium').map((x) => x.profileId).sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unlinkability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Profile, ProxyWarning } from './types';

function key(p: Profile): string | null {
  return p.proxy ? `${p.proxy.host}:${p.proxy.port}` : null;
}

export function findProxyConflicts(profiles: Profile[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const p of profiles) {
    const k = key(p);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p.id);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function proxyWarnings(profiles: Profile[]): ProxyWarning[] {
  const out: ProxyWarning[] = [];
  for (const p of profiles) {
    if (!p.proxy) {
      out.push({ profileId: p.id, level: 'high', message: 'Không có proxy — chia sẻ IP máy chủ, dễ bị liên kết.' });
    }
  }
  for (const ids of findProxyConflicts(profiles)) {
    for (const id of ids) {
      out.push({ profileId: id, level: 'medium', message: 'Trùng host proxy với profile khác — cùng IP.' });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unlinkability.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/unlinkability.ts tests/unlinkability.test.ts
git commit -m "feat: unlinkability proxy conflict + warnings"
```

---

## Task 5: ProfileStore (lowdb)

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProfileStore } from '../src/main/store';

async function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  let seed = 1000;
  let n = 0;
  const store = new ProfileStore(dir, { seedGen: () => ++seed, idGen: () => `id${++n}` });
  await store.init();
  return store;
}

describe('ProfileStore', () => {
  it('creates profile with generated seed, id, userDataDir', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    expect(p.id).toBe('id1');
    expect(p.seed).toBe(1001);
    expect(p.geoip).toBe(true);
    expect(p.userDataDir).toContain('id1');
    expect(store.list()).toHaveLength(1);
  });

  it('update merges fields', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.update(p.id, { name: 'B', lastOpenedAt: '2026-01-01' });
    expect(store.get(p.id)!.name).toBe('B');
    expect(store.get(p.id)!.lastOpenedAt).toBe('2026-01-01');
  });

  it('duplicate creates new id, new seed, new userDataDir', async () => {
    const store = await makeStore();
    const a = await store.create({ name: 'A', proxy: { type: 'http', host: 'h', port: 80 } });
    const b = await store.duplicate(a.id);
    expect(b.id).not.toBe(a.id);
    expect(b.seed).not.toBe(a.seed);
    expect(b.userDataDir).not.toBe(a.userDataDir);
    expect(b.proxy).toEqual(a.proxy);
  });

  it('remove deletes profile', async () => {
    const store = await makeStore();
    const p = await store.create({ name: 'A' });
    await store.remove(p.id);
    expect(store.get(p.id)).toBeUndefined();
  });

  it('persists across reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
    const s1 = new ProfileStore(dir, { idGen: () => 'fixed', seedGen: () => 7 });
    await s1.init();
    await s1.create({ name: 'A' });
    const s2 = new ProfileStore(dir);
    await s2.init();
    expect(s2.list()).toHaveLength(1);
    expect(s2.get('fixed')!.name).toBe('A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { JSONFilePreset } from 'lowdb/node';
import type { Low } from 'lowdb';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Profile, CreateProfileInput, UpdateProfileInput } from './types';

interface Data { profiles: Profile[] }
interface Opts { seedGen?: () => number; idGen?: () => string }

const defaultSeed = () => Math.floor(Math.random() * 89_990_000) + 10_000;

export class ProfileStore {
  private db!: Low<Data>;
  private seedGen: () => number;
  private idGen: () => string;

  constructor(private dataDir: string, opts: Opts = {}) {
    this.seedGen = opts.seedGen ?? defaultSeed;
    this.idGen = opts.idGen ?? randomUUID;
  }

  async init(): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    this.db = await JSONFilePreset<Data>(join(this.dataDir, 'cloak.json'), { profiles: [] });
  }

  list(): Profile[] { return this.db.data.profiles; }
  get(id: string): Profile | undefined { return this.db.data.profiles.find((p) => p.id === id); }

  async create(input: CreateProfileInput): Promise<Profile> {
    const id = this.idGen();
    const userDataDir = join(this.dataDir, 'profiles', id);
    mkdirSync(userDataDir, { recursive: true });
    const profile: Profile = {
      id,
      name: input.name,
      seed: this.seedGen(),
      proxy: input.proxy ?? null,
      geoip: input.geoip ?? true,
      timezone: input.timezone ?? null,
      locale: input.locale ?? null,
      userDataDir,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      lastOpenedAt: null,
    };
    this.db.data.profiles.push(profile);
    await this.db.write();
    return profile;
  }

  async update(id: string, patch: UpdateProfileInput): Promise<void> {
    const p = this.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    Object.assign(p, patch);
    await this.db.write();
  }

  async duplicate(id: string): Promise<Profile> {
    const src = this.get(id);
    if (!src) throw new Error(`Profile not found: ${id}`);
    return this.create({
      name: `${src.name} (copy)`,
      proxy: src.proxy,
      geoip: src.geoip,
      timezone: src.timezone,
      locale: src.locale,
    });
  }

  async remove(id: string): Promise<void> {
    const p = this.get(id);
    if (p) { try { rmSync(p.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ } }
    this.db.data.profiles = this.db.data.profiles.filter((x) => x.id !== id);
    await this.db.write();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/store.test.ts
git commit -m "feat: ProfileStore lowdb persistence"
```

---

## Task 6: FingerprintProbe

**Files:**
- Create: `src/main/fingerprint-probe.ts`
- Test: `tests/fingerprint-probe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseFingerprint, type RawProbe } from '../src/main/fingerprint-probe';

const raw: RawProbe = {
  userAgent: 'Mozilla/5.0 ... Chrome/146.0.0.0',
  platform: 'Win32',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  languages: ['en-US', 'en'],
  screenWidth: 1920, screenHeight: 1080, colorDepth: 24,
  devicePixelRatio: 1,
  webglVendor: 'Google Inc. (Intel)',
  webglRenderer: 'ANGLE (Intel)',
  timezone: 'America/New_York',
  webdriver: false,
};

describe('parseFingerprint', () => {
  it('maps raw probe to Fingerprint with screen object + capturedAt', () => {
    const fp = parseFingerprint(raw);
    expect(fp.screen).toEqual({ width: 1920, height: 1080, colorDepth: 24 });
    expect(fp.deviceMemory).toBe(8);
    expect(fp.webdriver).toBe(false);
    expect(fp.capturedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
  it('null deviceMemory when undefined', () => {
    const fp = parseFingerprint({ ...raw, deviceMemory: undefined });
    expect(fp.deviceMemory).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fingerprint-probe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { BrowserContext } from 'playwright-core';
import type { Fingerprint } from './types';

export interface RawProbe {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  languages: string[];
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  devicePixelRatio: number;
  webglVendor: string | null;
  webglRenderer: string | null;
  timezone: string;
  webdriver: boolean;
}

export function parseFingerprint(raw: RawProbe): Fingerprint {
  return {
    userAgent: raw.userAgent,
    platform: raw.platform,
    hardwareConcurrency: raw.hardwareConcurrency,
    deviceMemory: raw.deviceMemory ?? null,
    languages: raw.languages,
    screen: { width: raw.screenWidth, height: raw.screenHeight, colorDepth: raw.colorDepth },
    devicePixelRatio: raw.devicePixelRatio,
    webglVendor: raw.webglVendor,
    webglRenderer: raw.webglRenderer,
    timezone: raw.timezone,
    webdriver: raw.webdriver,
    capturedAt: new Date().toISOString(),
  };
}

// Hàm chạy trong trang để đọc giá trị thật. Tách ra để dễ đọc.
function probeInPage(): RawProbe {
  let webglVendor: string | null = null;
  let webglRenderer: string | null = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) {
      webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
      webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
    }
  } catch { /* ignore */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    languages: [...navigator.languages],
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    devicePixelRatio: window.devicePixelRatio,
    webglVendor,
    webglRenderer,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webdriver: navigator.webdriver,
  };
}

export async function captureFingerprint(context: BrowserContext): Promise<Fingerprint> {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    const raw = (await page.evaluate(probeInPage)) as RawProbe;
    return parseFingerprint(raw);
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fingerprint-probe.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/fingerprint-probe.ts tests/fingerprint-probe.test.ts
git commit -m "feat: fingerprint probe + parser"
```

---

## Task 7: BrowserManager

**Files:**
- Create: `src/main/browser-manager.ts`
- Test: `tests/browser-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import { ProfileStore } from '../src/main/store';
import { BrowserManager } from '../src/main/browser-manager';
import type { Fingerprint } from '../src/main/types';

function fakeContext() {
  const ee = new EventEmitter() as any;
  ee.close = vi.fn(async () => ee.emit('close'));
  return ee;
}

const fakeFp: Fingerprint = {
  userAgent: 'ua', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
  languages: ['en'], screen: { width: 1, height: 1, colorDepth: 24 }, devicePixelRatio: 1,
  webglVendor: null, webglRenderer: null, timezone: 'UTC', webdriver: false, capturedAt: 'now',
};

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cloak-'));
  const store = new ProfileStore(dir, { idGen: () => 'p1', seedGen: () => 9 });
  await store.init();
  await store.create({ name: 'A' });
  const ctx = fakeContext();
  const launcher = vi.fn(async () => ctx);
  const capture = vi.fn(async () => fakeFp);
  const mgr = new BrowserManager(store, launcher, capture);
  return { store, mgr, ctx, launcher, capture };
}

describe('BrowserManager', () => {
  it('launch calls launcher with fingerprint seed arg and tracks running', async () => {
    const { mgr, launcher } = await setup();
    await mgr.launch('p1');
    expect(launcher).toHaveBeenCalledOnce();
    expect(launcher.mock.calls[0][0].args).toContain('--fingerprint=9');
    expect(mgr.isRunning('p1')).toBe(true);
  });

  it('captures fingerprint on first launch and persists', async () => {
    const { mgr, store, capture } = await setup();
    await mgr.launch('p1');
    expect(capture).toHaveBeenCalledOnce();
    expect(store.get('p1')!.fingerprint).toEqual(fakeFp);
  });

  it('skips capture when fingerprint already present', async () => {
    const { mgr, store, capture } = await setup();
    await store.update('p1', { fingerprint: fakeFp });
    await mgr.launch('p1');
    expect(capture).not.toHaveBeenCalled();
  });

  it('context close marks stopped and emits status-changed', async () => {
    const { mgr, ctx } = await setup();
    const onChange = vi.fn();
    mgr.on('status-changed', onChange);
    await mgr.launch('p1');
    ctx.emit('close');
    expect(mgr.isRunning('p1')).toBe(false);
    expect(onChange).toHaveBeenCalledWith('p1', false);
  });

  it('stop closes context', async () => {
    const { mgr, ctx } = await setup();
    await mgr.launch('p1');
    await mgr.stop('p1');
    expect(ctx.close).toHaveBeenCalled();
    expect(mgr.isRunning('p1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/browser-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { EventEmitter } from 'events';
import type { BrowserContext } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs } from './launch-args';
import { captureFingerprint } from './fingerprint-probe';
import type { Fingerprint } from './types';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (ctx: BrowserContext) => Promise<Fingerprint>;

export class BrowserManager extends EventEmitter {
  private running = new Map<string, BrowserContext>();

  constructor(
    private store: ProfileStore,
    private launcher: Launcher = launchPersistentContext,
    private capturer: Capturer = captureFingerprint,
  ) { super(); }

  async launch(id: string): Promise<void> {
    if (this.running.has(id)) return;
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    const ctx = await this.launcher(buildLaunchArgs(profile));
    this.running.set(id, ctx);
    ctx.on('close', () => {
      this.running.delete(id);
      this.emit('status-changed', id, false);
    });

    if (!profile.fingerprint) {
      const fp = await this.capturer(ctx);
      await this.store.update(id, { fingerprint: fp });
    }
    await this.store.update(id, { lastOpenedAt: new Date().toISOString() });
    this.emit('status-changed', id, true);
  }

  async stop(id: string): Promise<void> {
    const ctx = this.running.get(id);
    if (ctx) await ctx.close();
    this.running.delete(id);
  }

  isRunning(id: string): boolean { return this.running.has(id); }
  runningIds(): string[] { return [...this.running.keys()]; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/browser-manager.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-manager.ts tests/browser-manager.test.ts
git commit -m "feat: BrowserManager launch/stop/track + fingerprint capture"
```

---

## Task 8: ProxyTester

**Files:**
- Create: `src/main/proxy-tester.ts`
- Test: `tests/proxy-tester.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ProxyTester } from '../src/main/proxy-tester';
import type { ProxyConfig } from '../src/main/types';

const proxy: ProxyConfig = { type: 'http', host: 'h', port: 80 };

function fakeBrowser(body: string, throwOn?: 'launch' | 'goto') {
  const page = {
    goto: vi.fn(async () => { if (throwOn === 'goto') throw new Error('timeout'); }),
    evaluate: vi.fn(async () => body),
  };
  const ctx = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  return vi.fn(async () => {
    if (throwOn === 'launch') throw new Error('bad proxy');
    return ctx;
  });
}

describe('ProxyTester', () => {
  it('returns ok with ip parsed from response', async () => {
    const tester = new ProxyTester(fakeBrowser('{"ip":"9.9.9.9"}') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('9.9.9.9');
    expect(typeof r.latencyMs).toBe('number');
  });

  it('returns error when launch fails', async () => {
    const tester = new ProxyTester(fakeBrowser('', 'launch') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bad proxy');
  });

  it('returns error when goto fails', async () => {
    const tester = new ProxyTester(fakeBrowser('', 'goto') as any);
    const r = await tester.test(proxy);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proxy-tester.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Browser } from 'playwright-core';
import type { LaunchOptions } from 'cloakbrowser';
import { launch } from 'cloakbrowser';
import { toProxyUrl } from './launch-args';
import type { ProxyConfig, ProxyTestResult } from './types';

type Launcher = (opts: LaunchOptions) => Promise<Browser>;

export class ProxyTester {
  constructor(private launcher: Launcher = launch) {}

  async test(proxy: ProxyConfig): Promise<ProxyTestResult> {
    const start = Date.now();
    let browser: Browser | undefined;
    try {
      browser = await this.launcher({ headless: true, proxy: toProxyUrl(proxy) });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('https://api.ipify.org?format=json', { timeout: 20000 });
      const body = await page.evaluate(() => document.body.innerText);
      await ctx.close();
      const ip = JSON.parse(body).ip as string;
      return { ok: true, ip, latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}
```

Note: the test's fake browser exposes `newPage` directly on the context returned by launcher; the real Playwright `Browser` needs `newContext()`. Adjust the test's `ctx` to add `newContext` returning the inner context. Update the fake:
```ts
function fakeBrowser(body: string, throwOn?: 'launch' | 'goto') {
  const page = {
    goto: vi.fn(async () => { if (throwOn === 'goto') throw new Error('timeout'); }),
    evaluate: vi.fn(async () => body),
  };
  const ctx = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  const browser = { newContext: vi.fn(async () => ctx), close: vi.fn(async () => {}) };
  return vi.fn(async () => {
    if (throwOn === 'launch') throw new Error('bad proxy');
    return browser;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proxy-tester.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy-tester.ts tests/proxy-tester.test.ts
git commit -m "feat: ProxyTester verify proxy exit IP"
```

---

## Task 9: macOS quarantine clear

**Files:**
- Create: `src/main/quarantine.ts`
- Test: `tests/quarantine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { clearQuarantine } from '../src/main/quarantine';

describe('clearQuarantine', () => {
  it('runs xattr -cr on darwin', async () => {
    const exec = vi.fn((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null));
    await clearQuarantine('/path/Chromium.app', 'darwin', exec as any);
    expect(exec).toHaveBeenCalledWith('xattr', ['-cr', '/path/Chromium.app'], expect.any(Function));
  });

  it('no-op on non-darwin', async () => {
    const exec = vi.fn();
    await clearQuarantine('/path', 'win32', exec as any);
    expect(exec).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/quarantine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { execFile } from 'child_process';

type ExecFile = typeof execFile;

export async function clearQuarantine(
  binaryAppPath: string,
  platform: NodeJS.Platform = process.platform,
  exec: ExecFile = execFile,
): Promise<void> {
  if (platform !== 'darwin') return;
  await new Promise<void>((resolve) => {
    exec('xattr', ['-cr', binaryAppPath], () => resolve()); // best-effort
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/quarantine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/quarantine.ts tests/quarantine.test.ts
git commit -m "feat: macOS quarantine clear for stealth binary"
```

---

## Task 10: IPC layer + preload

**Files:**
- Create: `src/main/ipc.ts`, `src/preload/preload.ts` (replace stub)

- [ ] **Step 1: Write `src/main/ipc.ts`**

```ts
import { ipcMain, BrowserWindow } from 'electron';
import type { ProfileStore } from './store';
import type { BrowserManager } from './browser-manager';
import type { ProxyTester } from './proxy-tester';
import { proxyWarnings } from './unlinkability';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, ProfileRuntime } from './types';

export function registerIpc(
  store: ProfileStore,
  manager: BrowserManager,
  proxyTester: ProxyTester,
) {
  const withRuntime = (): ProfileRuntime[] =>
    store.list().map((p) => ({ ...p, running: manager.isRunning(p.id) }));

  ipcMain.handle('profiles:list', () => withRuntime());
  ipcMain.handle('profiles:warnings', () => proxyWarnings(store.list()));
  ipcMain.handle('profiles:create', (_e, input: CreateProfileInput) => store.create(input));
  ipcMain.handle('profiles:update', (_e, id: string, patch: UpdateProfileInput) => store.update(id, patch));
  ipcMain.handle('profiles:duplicate', (_e, id: string) => store.duplicate(id));
  ipcMain.handle('profiles:delete', (_e, id: string) => store.remove(id));

  ipcMain.handle('browser:launch', (_e, id: string) => manager.launch(id));
  ipcMain.handle('browser:stop', (_e, id: string) => manager.stop(id));
  ipcMain.handle('browser:running', () => manager.runningIds());

  ipcMain.handle('proxy:test', (_e, proxy: ProxyConfig) => proxyTester.test(proxy));

  // Push status changes (user closes a Chrome window) to all renderer windows.
  manager.on('status-changed', (id: string, running: boolean) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('browser:status-changed', { id, running });
    }
  });
}
```

- [ ] **Step 2: Write `src/preload/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig } from '../main/types';

const api = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  warnings: () => ipcRenderer.invoke('profiles:warnings'),
  createProfile: (input: CreateProfileInput) => ipcRenderer.invoke('profiles:create', input),
  updateProfile: (id: string, patch: UpdateProfileInput) => ipcRenderer.invoke('profiles:update', id, patch),
  duplicateProfile: (id: string) => ipcRenderer.invoke('profiles:duplicate', id),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
  launch: (id: string) => ipcRenderer.invoke('browser:launch', id),
  stop: (id: string) => ipcRenderer.invoke('browser:stop', id),
  testProxy: (proxy: ProxyConfig) => ipcRenderer.invoke('proxy:test', proxy),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => {
    const handler = (_e: unknown, payload: { id: string; running: boolean }) => cb(payload);
    ipcRenderer.on('browser:status-changed', handler);
    return () => ipcRenderer.removeListener('browser:status-changed', handler);
  },
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/preload.ts
git commit -m "feat: IPC layer + typed preload bridge"
```

---

## Task 11: Wire main process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Replace `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { ensureBinary, binaryInfo } from 'cloakbrowser';
import { ProfileStore } from './store';
import { BrowserManager } from './browser-manager';
import { ProxyTester } from './proxy-tester';
import { registerIpc } from './ipc';
import { clearQuarantine } from './quarantine';

let store: ProfileStore;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  // Ensure the stealth binary exists, then clear macOS quarantine on it.
  await ensureBinary();
  try {
    const info = binaryInfo();
    await clearQuarantine(info.binaryPath);
  } catch { /* best-effort */ }

  store = new ProfileStore(app.getPath('userData'));
  await store.init();
  const manager = new BrowserManager(store);
  const proxyTester = new ProxyTester();
  registerIpc(store, manager, proxyTester);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 2: Verify dev still boots (binary may download ~200MB on first run)**

Run: `npm run dev`
Expected: app boots; console shows binary ensure step; window opens. (Renderer still stub until Task 13.)

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire main process services + binary bootstrap"
```

---

## Task 12: Renderer API wrapper + global type

**Files:**
- Create: `src/renderer/api.ts`, `src/renderer/global.d.ts`

- [ ] **Step 1: Write `src/renderer/global.d.ts`**

```ts
import type { Api } from '../preload/preload';
declare global {
  interface Window { api: Api }
}
export {};
```

- [ ] **Step 2: Write `src/renderer/api.ts`**

```ts
import type { ProfileRuntime, CreateProfileInput, UpdateProfileInput, ProxyConfig, ProxyTestResult, ProxyWarning } from '../main/types';

export const api = {
  list: (): Promise<ProfileRuntime[]> => window.api.listProfiles(),
  warnings: (): Promise<ProxyWarning[]> => window.api.warnings(),
  create: (i: CreateProfileInput) => window.api.createProfile(i),
  update: (id: string, p: UpdateProfileInput) => window.api.updateProfile(id, p),
  duplicate: (id: string) => window.api.duplicateProfile(id),
  remove: (id: string) => window.api.deleteProfile(id),
  launch: (id: string) => window.api.launch(id),
  stop: (id: string) => window.api.stop(id),
  testProxy: (p: ProxyConfig): Promise<ProxyTestResult> => window.api.testProxy(p),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => window.api.onStatusChanged(cb),
};
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/api.ts src/renderer/global.d.ts
git commit -m "feat: renderer typed api wrapper"
```

---

## Task 13: Renderer UI

**Files:**
- Create: `src/renderer/components/ProfileForm.tsx`, `src/renderer/components/FingerprintPanel.tsx`, `src/renderer/components/ProfileList.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write `src/renderer/components/FingerprintPanel.tsx`**

```tsx
import type { Fingerprint } from '../../main/types';

export function FingerprintPanel({ fp }: { fp: Fingerprint | null }) {
  if (!fp) return <p className="text-sm text-gray-500">Chưa có — mở profile lần đầu để CloakBrowser sinh fingerprint.</p>;
  const rows: [string, string][] = [
    ['User Agent', fp.userAgent],
    ['Platform', fp.platform],
    ['CPU cores', String(fp.hardwareConcurrency)],
    ['RAM (GB)', fp.deviceMemory == null ? '—' : String(fp.deviceMemory)],
    ['Languages', fp.languages.join(', ')],
    ['Screen', `${fp.screen.width}×${fp.screen.height} @${fp.screen.colorDepth}bit`],
    ['DPR', String(fp.devicePixelRatio)],
    ['WebGL vendor', fp.webglVendor ?? '—'],
    ['WebGL renderer', fp.webglRenderer ?? '—'],
    ['Timezone', fp.timezone],
    ['webdriver', String(fp.webdriver)],
  ];
  return (
    <table className="text-sm w-full">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-gray-100">
            <td className="py-1 pr-3 font-medium text-gray-600 whitespace-nowrap align-top">{k}</td>
            <td className="py-1 break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Write `src/renderer/components/ProfileForm.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../api';
import type { CreateProfileInput, ProxyConfig, ProxyTestResult } from '../../main/types';

export function ProfileForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [type, setType] = useState<'http' | 'socks5'>('socks5');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [geoip, setGeoip] = useState(true);
  const [test, setTest] = useState<ProxyTestResult | null>(null);
  const [busy, setBusy] = useState(false);

  const proxy = (): ProxyConfig | null =>
    useProxy && host && port
      ? { type, host, port: Number(port), username: username || undefined, password: password || undefined }
      : null;

  async function runTest() {
    const p = proxy();
    if (!p) return;
    setBusy(true);
    setTest(await api.testProxy(p));
    setBusy(false);
  }

  async function submit() {
    const input: CreateProfileInput = { name: name || 'Profile', proxy: proxy(), geoip };
    await api.create(input);
    onCreated();
  }

  const field = 'border rounded px-2 py-1 text-sm w-full';
  return (
    <div className="space-y-3 p-4 border rounded bg-white">
      <h2 className="font-semibold">Profile mới</h2>
      <input className={field} placeholder="Tên profile" value={name} onChange={(e) => setName(e.target.value)} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} /> Dùng proxy (khuyến nghị cho anti-detect)
      </label>
      {!useProxy && <p className="text-xs text-red-600">⚠ Không proxy = chia sẻ IP máy chủ, dễ bị liên kết.</p>}

      {useProxy && (
        <div className="space-y-2">
          <select className={field} value={type} onChange={(e) => setType(e.target.value as 'http' | 'socks5')}>
            <option value="socks5">SOCKS5 (khuyến nghị)</option>
            <option value="http">HTTP</option>
          </select>
          <div className="flex gap-2">
            <input className={field} placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
            <input className={field} placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <input className={field} placeholder="User (tùy chọn)" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className={field} placeholder="Pass (tùy chọn)" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={geoip} onChange={(e) => setGeoip(e.target.checked)} /> GeoIP (khớp timezone/locale theo IP proxy)
          </label>
          <button className="text-sm px-3 py-1 border rounded" disabled={busy} onClick={runTest}>
            {busy ? 'Đang test...' : 'Test proxy'}
          </button>
          {test && (
            <p className={`text-xs ${test.ok ? 'text-green-700' : 'text-red-600'}`}>
              {test.ok ? `OK — IP ${test.ip} (${test.latencyMs}ms)` : `Lỗi: ${test.error}`}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button className="px-3 py-1 bg-black text-white rounded text-sm" onClick={submit}>Tạo</button>
        <button className="px-3 py-1 border rounded text-sm" onClick={onCancel}>Hủy</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/renderer/components/ProfileList.tsx`**

```tsx
import { useState } from 'react';
import { api } from '../api';
import type { ProfileRuntime, ProxyWarning } from '../../main/types';
import { FingerprintPanel } from './FingerprintPanel';

export function ProfileList({
  profiles, warnings, refresh,
}: { profiles: ProfileRuntime[]; warnings: ProxyWarning[]; refresh: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const warnFor = (id: string) => warnings.filter((w) => w.profileId === id);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-2">Tên</th><th>Proxy</th><th>Trạng thái</th><th>Mở lần cuối</th><th></th>
        </tr>
      </thead>
      <tbody>
        {profiles.map((p) => (
          <>
            <tr key={p.id} className="border-b">
              <td className="py-2">
                {p.name}
                {warnFor(p.id).map((w, i) => (
                  <span key={i} title={w.message} className={w.level === 'high' ? 'text-red-600' : 'text-amber-600'}> ⚠</span>
                ))}
              </td>
              <td>{p.proxy ? `${p.proxy.type}://${p.proxy.host}:${p.proxy.port}` : <span className="text-red-600">—</span>}</td>
              <td>{p.running ? <span className="text-green-700">● running</span> : 'stopped'}</td>
              <td>{p.lastOpenedAt ? new Date(p.lastOpenedAt).toLocaleString() : '—'}</td>
              <td className="text-right space-x-2 whitespace-nowrap">
                {p.running
                  ? <button className="px-2 py-1 border rounded" onClick={() => api.stop(p.id).then(refresh)}>Dừng</button>
                  : <button className="px-2 py-1 bg-black text-white rounded" onClick={() => api.launch(p.id).then(refresh)}>Mở</button>}
                <button className="px-2 py-1 border rounded" onClick={() => setOpenId(openId === p.id ? null : p.id)}>FP</button>
                <button className="px-2 py-1 border rounded" onClick={() => api.duplicate(p.id).then(refresh)}>Nhân bản</button>
                <button className="px-2 py-1 border rounded text-red-600" onClick={() => api.remove(p.id).then(refresh)}>Xóa</button>
              </td>
            </tr>
            {openId === p.id && (
              <tr key={p.id + '-fp'}><td colSpan={5} className="bg-gray-50 p-3"><FingerprintPanel fp={p.fingerprint} /></td></tr>
            )}
          </>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Replace `src/renderer/App.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { ProfileRuntime, ProxyWarning } from '../main/types';
import { ProfileList } from './components/ProfileList';
import { ProfileForm } from './components/ProfileForm';

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRuntime[]>([]);
  const [warnings, setWarnings] = useState<ProxyWarning[]>([]);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setProfiles(await api.list());
    setWarnings(await api.warnings());
  }, []);

  useEffect(() => {
    refresh();
    const off = api.onStatusChanged(() => refresh());
    return off;
  }, [refresh]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Anti-Detect Profiles</h1>
        <button className="px-3 py-1 bg-black text-white rounded text-sm" onClick={() => setCreating(true)}>+ Profile</button>
      </div>
      {creating && <ProfileForm onCreated={() => { setCreating(false); refresh(); }} onCancel={() => setCreating(false)} />}
      <ProfileList profiles={profiles} warnings={warnings} refresh={refresh} />
    </div>
  );
}
```

- [ ] **Step 5: Run app and verify end-to-end manually**

Run: `npm run dev`
Expected:
- Tạo profile có proxy → "Test proxy" trả IP.
- Bấm "Mở" → cửa sổ Chrome thật bật ra; thao tác tay được.
- Bấm "FP" → bảng fingerprint hiện giá trị, `webdriver=false`.
- Đóng cửa sổ Chrome → dòng chuyển về "stopped" (qua status-changed).
- Tạo profile thứ 2 không proxy → hiện ⚠ đỏ.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: renderer UI — profile list, form, fingerprint panel, warnings"
```

---

## Task 14: Packaging config

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json` (build metadata if needed)

- [ ] **Step 1: Write `electron-builder.yml`**

```yaml
appId: dev.uiauia.login
productName: uiauia-login
directories:
  output: release
files:
  - out/**/*
  - package.json
asarUnpack:
  - "**/node_modules/cloakbrowser/**"
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  category: public.app-category.utilities
  hardenedRuntime: true
win:
  target:
    - target: nsis
      arch: [x64]
```

> Note: `cloakbrowser` is unpacked from asar so it can spawn the Chromium binary and write the cache dir at runtime.

- [ ] **Step 2: Build distributable for current OS**

Run (on macOS): `npm run dist:mac`
Run (on Windows): `npm run dist:win`
Expected: `release/` chứa `.dmg` (mac) hoặc `.exe` (win). (Chưa ký → cảnh báo Gatekeeper/SmartScreen khi cài; chấp nhận cho bản thử.)

- [ ] **Step 3: Smoke-test the packaged app**

Cài file trong `release/`, mở app, tạo + mở 1 profile.
Expected: hoạt động như bản dev (binary tự tải lần đầu nếu máy chưa có).

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml package.json
git commit -m "build: electron-builder packaging for mac + win"
```

---

## Task 15: Integration tests (real binary, @slow)

**Files:**
- Create: `tests/integration/anti-detect.test.ts`, `vitest.config.ts` (if not present)

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 120000,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Write integration test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProfileStore } from '../../src/main/store';
import { BrowserManager } from '../../src/main/browser-manager';

describe('anti-detect integration (real binary)', () => {
  it('two profiles get different fingerprints and webdriver=false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloak-int-'));
    const store = new ProfileStore(dir);
    await store.init();
    const a = await store.create({ name: 'A' });
    const b = await store.create({ name: 'B' });
    const mgr = new BrowserManager(store);

    await mgr.launch(a.id);
    await mgr.launch(b.id);
    await mgr.stop(a.id);
    await mgr.stop(b.id);

    const fa = store.get(a.id)!.fingerprint!;
    const fb = store.get(b.id)!.fingerprint!;
    expect(fa.webdriver).toBe(false);
    expect(fb.webdriver).toBe(false);
    // Different seeds => at least one hardware/graphics signal should differ.
    const differ =
      fa.webglRenderer !== fb.webglRenderer ||
      fa.userAgent !== fb.userAgent ||
      fa.screen.width !== fb.screen.width ||
      fa.hardwareConcurrency !== fb.hardwareConcurrency;
    expect(differ).toBe(true);
  });
});
```

- [ ] **Step 3: Run integration test (downloads binary on first run)**

Run: `npx vitest run tests/integration/anti-detect.test.ts`
Expected: PASS. Two profiles produce distinct fingerprints; `webdriver=false`.

> If both fingerprints are identical, that's a real anti-detect failure to investigate (seed not applied / shared profile) — do not weaken the assertion.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all unit tests pass (integration runs too — allow time for binary).

- [ ] **Step 5: Commit**

```bash
git add tests/integration vitest.config.ts
git commit -m "test: anti-detect integration — distinct fingerprints across profiles"
```

---

## Self-Review (đã thực hiện khi viết plan)

**1. Spec coverage:**
- Cross-instance unlinkability (spec §2): proxy per profile (Task 5/13), webrtc flag (Task 3), geoip default (Task 3/13), seed cố định (Task 5), userDataDir riêng (Task 5), cảnh báo no-proxy/trùng proxy (Task 4/13), native platform (Task 3 — không spoof). ✓
- Scope MVP (spec §3): CRUD (Task 5/13), launch/stop headed (Task 7/13), proxy+test (Task 8/13), fingerprint read-only (Task 6/13), packaging (Task 14). ✓
- Architecture Electron thuần (spec §4): Task 1/10/11. ✓
- Data model (spec §6): Task 2/5. ✓
- Components (spec §7): Task 3–11 ánh xạ 1-1. ✓
- Launch flow (spec §8): Task 3 + Task 11. ✓
- Fingerprint display (spec §9): Task 6 + Task 13. ✓
- Packaging/macOS xattr (spec §10): Task 9 + Task 11 + Task 14. ✓
- Testing (spec §12): Task 3–9 unit + Task 15 integration. ✓

**2. Placeholder scan:** Không còn TBD/TODO; mọi step có code/command cụ thể. ✓

**3. Type consistency:** `Profile`, `ProxyConfig`, `Fingerprint`, `ProxyWarning`, `ProfileRuntime`, `CreateProfileInput`, `UpdateProfileInput` định nghĩa ở Task 2, dùng nhất quán ở Task 3–13. `buildLaunchArgs`, `toProxyUrl`, `parseFingerprint`, `captureFingerprint`, `findProxyConflicts`, `proxyWarnings`, `clearQuarantine` — tên dùng khớp giữa định nghĩa và nơi gọi. ✓ (Lưu ý đã sửa fake browser ở Task 8 Step 3 để có `newContext`.)
