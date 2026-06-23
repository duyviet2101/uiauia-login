# Fingerprint Hardening (Geo / DNT / IPv6 / Fonts) — Context + Research + Plan

> **For agentic workers:** thực thi theo `superpowers:subagent-driven-development` hoặc `executing-plans`, task-by-task. Steps dùng checkbox `- [ ]`. Mọi lệnh node/npx/tsc/vitest chạy Node 20: prefix `PATH="/Users/duyviet/.nvm/versions/node/v20.19.5/bin:$PATH" <cmd>` (node hệ thống = v16, vitest crash).

**Goal:** Vá 4 hạng mục còn thiếu trong audit 19-mục BitBrowser: **Geo (chặn)**, **Do Not Track**, **IPv6 leak check**, **Fonts (fonts-dir, tùy chọn)**.

**Repo:** `/Users/duyviet/workspaces/login-anti-detect/uiauia-login`, branch `main`. Tạo branch mới trước khi code.

> ⚠️ **ĐỌC CODE HIỆN TẠI TRƯỚC — plan này viết 2026-06-22, code đã tiến hoá.** Các snippet dưới là HƯỚNG, không phải copy nguyên. Bắt buộc đọc lại `src/main/{launch-args,types,store,browser-manager,proxy-tester}.ts` + test tương ứng trước mỗi task. Thay đổi đã biết: `buildLaunchArgs(p, display?)` — tham số 2 GIỜ LÀ `display` (screen theo màn hình thật, KHÔNG theo seed nữa); `deriveHardwareProfile(seed)` chỉ trả cores/memory; `Profile` đã có thêm `diagnostics`, `windowCustomization`. → Task 6 phải thêm `fontsDir` như **tham số 3** (hoặc cơ chế khác), KHÔNG đè lên `display`.
>
> ✅ **Fonts đã chốt = Cách 1** (CI copy `C:\Windows\Fonts` từ Windows runner; gitignore; artifact sang job macOS). Thêm 1 task CI cho việc này (sửa `release.yml`). KHÔNG commit font MS vào repo public.

---

## 1. Context — vì sao 4 mục này

Sau audit 19-mục (xem `docs/antidetect-multi-profile-stability-audit.md` + đánh giá trong lịch sử chat), trạng thái:
- ✅ Đã vững: IPv4/proxy, Language, Resolution, Timezone, localStorage, Cookie, IndexedDB, WebGL, UserAgent, WebRTC (+Canvas/Audio trên Win/Linux).
- ⚠️/❌ Cần vá: **Geo** (toạ độ chưa kiểm soát), **DNT** (chưa set), **IPv6** (chưa kiểm leak), **Fonts** (enumerate font OS thật, chưa normalize). Canvas+Audio trên macOS là giới hạn binary (không vá được ở app — chạy account giá trị cao trên Windows; dùng diagnostics đã có để kiểm).

`launch-args.ts` hiện wire: `--fingerprint`, `--fingerprint-platform`, `--ignore-gpu-blocklist`, `--fingerprint-screen-width/height`, `--fingerprint-hardware-concurrency`, `--fingerprint-device-memory`, `--fingerprint-webrtc-ip`, + context opts `proxy/geoip/timezone/locale`. Diagnostics (`captureFingerprintDiagnostics`) đo local canvas/audio/font — chỉ *đo*, không *spoof*.

---

## 2. Kết quả nghiên cứu — ĐÃ VERIFY THỰC NGHIỆM (2026-06-22, trên binary macOS 25-patch của máy này)

**Probe A — `--fingerprint-location` (hướng "match city"): HỎNG trên Mac.**
```
flag="--fingerprint-location=37.7749,-122.4194"      => {"error":"Timeout expired","code":3}
flag="--fingerprint-location=37.7749,-122.4194,100"  => {"error":"Timeout expired","code":3}
```
→ Binary Mac 25-patch không honor flag location (cùng kiểu lag canvas/audio). **"Match city" không đáng tin trên Mac.**

**Probe B — Seed Chrome `Default/Preferences` (hướng "block" + DNT): CHẠY SẠCH.**
Ghi `<userDataDir>/Default/Preferences` = `{"enable_do_not_track":true,"profile":{"default_content_setting_values":{"geolocation":2}}}` trước khi launch →
```
{"doNotTrack":"1","geolocationPermission":"denied","getCurrentPosition":"error code=1 (User denied Geolocation)"}
```
→ Pref thật (undetectable, không JS hack), chạy trên Mac. `geolocation:2` = block. Triệt tiêu vector lộ vị trí thật qua WiFi-AP khi user lỡ bấm Allow.

**Probe C — `--fingerprint-fonts-dir`: SANDBOX enumeration về đúng thư mục bundle (giấu HẾT font host, kể cả font cài thêm).**
```
# Test 20 font đặc trưng-Mac (giả lập "font host cài thêm"):
BASELINE (no fonts-dir):        20/20  [Geneva,Avenir,Menlo,Monaco,Zapfino,Papyrus,Futura,Gill Sans...]
WITH --fingerprint-fonts-dir:    1/20  [gần như TẤT CẢ font host biến mất]
```
→ **KẾT LUẬN QUAN TRỌNG:** mặc định, font host (kể cả font user cài thêm) lọt vào MỌI profile. fonts-dir **sandbox** danh sách về đúng bộ bundle (+ baseline nhỏ) → giấu hết font host, bất kể máy cài thêm gì. **Đáng làm cho MỌI deployment** (kể cả Windows thật — để giấu font cài thêm), KHÔNG chỉ máy Mac. ⚠️ **Bộ bundle phải ĐẦY ĐỦ một bộ Windows chuẩn** (~toàn bộ `C:\Windows\Fonts` thường gặp); bundle thiếu → vân tay font thưa bất thường (test 1 font = 1/20 = giả lộ liễu). Font do user cấp (license MS là của user).

**Probe scripts** (tham khảo, ở `/tmp/cbprobe/`): `geoprobe.mjs`, `prefprobe.mjs`, `fontprobe.mjs` — chạy bằng `node v22.22.1 --experimental-strip-types` import `cloakbrowser` từ `node_modules`.

---

## 3. Quyết định

| Mục | Quyết định | Cơ chế |
|---|---|---|
| **Geo** | **BLOCK** (không match) | `Preferences` `default_content_setting_values.geolocation=2`. Default ON. |
| **DNT** | Toggle per-profile | `Preferences` `enable_do_not_track`. Default OFF (=null, phổ biến nhất). |
| **IPv6** | Check (cảnh báo) | Query IPv6-echo qua browser proxied trong proxy-tester. Best-effort signal. |
| **DNS** | NGOÀI phạm vi | Leak-test thật cần hạ tầng callback/API ngoài. Ghi chú, không làm offline. |
| **Fonts** | Wire `--fingerprint-fonts-dir`, **tùy chọn** | Folder gitignore `build/fonts/windows` + extraResources; user thả font. Chỉ áp khi platform=windows + dir tồn tại. |

Geo-block + DNT dùng **chung 1 module** `chrome-prefs.ts` (seed Preferences, idempotent merge, gọi trước mỗi launch).

---

## 4. ❓ OPEN QUESTION (quyết định scope Fonts) — ĐÃ LÀM RÕ

**fonts-dir đáng làm cho MỌI deployment** (đã verify Probe C: giấu font host cài thêm, kể cả trên máy Windows thật — đây CHÍNH là rủi ro user nêu: máy Windows khác cài thêm font lạ → mọi profile lộ font đó). Quyết định thật sự: **user có sẵn sàng bundle một bộ font Windows ĐẦY ĐỦ (chuẩn) không?**
- **Có** → làm Task 6, để fonts-dir **default ON khi bundle tồn tại + đủ font** (≥~50 file). Áp cho mọi profile platform=windows, bất kể host là Mac hay Windows.
- **Không/chưa** → BỎ Task 6, ghi rõ residual: font host (kể cả font cài thêm) sẽ lộ và giống nhau giữa các profile trên cùng máy. Dùng diagnostics để theo dõi.
⚠️ Bundle THIẾU font còn hại hơn không bundle (sandbox về vài font = vân tay thưa giả lộ liễu). Hỏi user trước khi làm Task 6.

---

## 5. File structure

| File | Trách nhiệm |
|---|---|
| `src/main/chrome-prefs.ts` (mới) | `seedChromePreferences(userDataDir, {blockGeolocation, doNotTrack})` — merge vào Default/Preferences. |
| `src/main/types.ts` (sửa) | thêm `blockGeolocation`, `doNotTrack` vào `Profile` + `CreateProfileInput`. |
| `src/main/store.ts` (sửa) | default khi create + migrate backfill (existing → block:true, dnt:false). |
| `src/main/browser-manager.ts` (sửa) | gọi seeder trước `launcher(buildLaunchArgs(...))`; truyền fontsDir vào buildLaunchArgs. |
| `src/main/launch-args.ts` (sửa) | `buildLaunchArgs(p, fontsDir?)` → thêm `--fingerprint-fonts-dir` khi có dir + windows. |
| `src/main/fonts-dir.ts` (mới, Task 6) | resolve path bộ font Windows (resourcesPath/dev). |
| `src/main/proxy-tester.ts` (sửa, Task 5) | thêm probe IPv6 + field `ipv6`. |
| `src/main/unlinkability.ts` (sửa, Task 5) | cảnh báo khi IPv6 lộ. |
| `src/renderer/components/ProfileForm.tsx` (sửa) | 2 toggle: chặn geo, DNT. |
| `electron-builder.yml` (sửa, Task 6) | `extraResources` cho fonts. |
| `.gitignore` (sửa, Task 6) | bỏ qua `build/fonts/windows/*`. |
| tests tương ứng | `chrome-prefs.test.ts`, +store, +browser-manager, +launch-args, +proxy-tester. |

---

## Task 1: Profile fields + defaults + migration

**Files:** Modify `src/main/types.ts`, `src/main/store.ts`; Test `tests/store.test.ts`.

- [ ] **Step 1 — Đọc** `src/main/store.ts` để nắm `create()`, `migrate()`, `SCHEMA_VERSION` (pattern backfill có sẵn).

- [ ] **Step 2 — Test thất bại** (thêm vào `tests/store.test.ts`): tạo profile mới → `blockGeolocation === true`, `doNotTrack === false`. Và: nạp 1 profile cũ thiếu field (mô phỏng data cũ) qua migrate → được backfill `blockGeolocation:true, doNotTrack:false`. (Theo đúng style test migrate hiện có trong file.)

- [ ] **Step 3 — `types.ts`:** thêm vào `interface Profile` (sau `lastProxyCheck`):
```ts
  blockGeolocation: boolean;
  doNotTrack: boolean;
```
và vào `interface CreateProfileInput`:
```ts
  blockGeolocation?: boolean;
  doNotTrack?: boolean;
```

- [ ] **Step 4 — `store.ts`:** trong `create()` set default `blockGeolocation: input.blockGeolocation ?? true`, `doNotTrack: input.doNotTrack ?? false`. Trong `migrate()` backfill: nếu field `undefined` → set `true`/`false` tương ứng (theo pattern backfill SCHEMA_VERSION hiện có; tăng SCHEMA_VERSION nếu file đang dùng cơ chế đó).

- [ ] **Step 5 — Chạy test** (`npx vitest run tests/store.test.ts`) PASS + `npx tsc --noEmit -p tsconfig.json` clean.

- [ ] **Step 6 — Commit** `feat(privacy): profile blockGeolocation + doNotTrack fields`.

---

## Task 2: chrome-prefs.ts seeder (TDD)

**Files:** Create `src/main/chrome-prefs.ts`, `tests/chrome-prefs.test.ts`.

- [ ] **Step 1 — Test thất bại** `tests/chrome-prefs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { seedChromePreferences } from '../src/main/chrome-prefs';

const prefs = (dir: string) => JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'));

describe('seedChromePreferences', () => {
  it('block geolocation + DNT ghi đúng pref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    seedChromePreferences(dir, { blockGeolocation: true, doNotTrack: true });
    const p = prefs(dir);
    expect(p.profile.default_content_setting_values.geolocation).toBe(2);
    expect(p.enable_do_not_track).toBe(true);
  });
  it('merge, giữ pref sẵn có', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    mkdirSync(join(dir, 'Default'), { recursive: true });
    writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({ foo: 1, profile: { name: 'x' } }));
    seedChromePreferences(dir, { blockGeolocation: true, doNotTrack: false });
    const p = prefs(dir);
    expect(p.foo).toBe(1);
    expect(p.profile.name).toBe('x');
    expect(p.profile.default_content_setting_values.geolocation).toBe(2);
    expect(p.enable_do_not_track).toBeUndefined();
  });
  it('block=false xoá key (về mặc định ask)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-'));
    seedChromePreferences(dir, { blockGeolocation: false, doNotTrack: false });
    const p = prefs(dir);
    expect(p.profile.default_content_setting_values.geolocation).toBeUndefined();
  });
});
```

- [ ] **Step 2 — Chạy** `npx vitest run tests/chrome-prefs.test.ts` → FAIL (module chưa có).

- [ ] **Step 3 — Tạo `src/main/chrome-prefs.ts`:**
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export interface ChromePrefsOptions {
  blockGeolocation: boolean;
  doNotTrack: boolean;
}

/**
 * Seed the persistent profile's Default/Preferences with privacy settings
 * Chromium reads on startup — REAL prefs (undetectable), not JS overrides.
 * Verified 2026-06-22: geolocation=2 -> permission "denied"; enable_do_not_track
 * -> navigator.doNotTrack "1". Idempotent merge into any existing Preferences.
 */
export function seedChromePreferences(userDataDir: string, opts: ChromePrefsOptions): void {
  const prefsPath = join(userDataDir, 'Default', 'Preferences');
  let prefs: Record<string, unknown> = {};
  if (existsSync(prefsPath)) {
    try { prefs = JSON.parse(readFileSync(prefsPath, 'utf8')) as Record<string, unknown>; } catch { prefs = {}; }
  }
  if (opts.doNotTrack) prefs.enable_do_not_track = true;
  else delete prefs.enable_do_not_track;

  const profile = (prefs.profile as Record<string, unknown>) ?? {};
  const csv = (profile.default_content_setting_values as Record<string, unknown>) ?? {};
  if (opts.blockGeolocation) csv.geolocation = 2;
  else delete csv.geolocation;
  profile.default_content_setting_values = csv;
  prefs.profile = profile;

  mkdirSync(dirname(prefsPath), { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(prefs));
}
```

- [ ] **Step 4 — Chạy** PASS (3 tests) + tsc clean.
- [ ] **Step 5 — Commit** `feat(privacy): chrome Preferences seeder (geo block + DNT)`.

---

## Task 3: Wire seeder vào browser-manager (trước launch)

**Files:** Modify `src/main/browser-manager.ts`; Test `tests/browser-manager.test.ts`.

- [ ] **Step 1 — Đọc** `browser-manager.ts` (constructor DI pattern; `launch()` gọi `this.launcher(buildLaunchArgs(profile))`).

- [ ] **Step 2 — Test thất bại:** inject 1 `prefsSeeder` giả; assert `launch(id)` gọi nó với `(profile.userDataDir, { blockGeolocation, doNotTrack })` **trước** khi launcher chạy. (Theo style test có sẵn — đã có mock launcher/capturer.)

- [ ] **Step 3 — Impl:** import `seedChromePreferences`; thêm vào constructor một param injectable `private prefsSeeder: (dir: string, o: { blockGeolocation: boolean; doNotTrack: boolean }) => void = seedChromePreferences`. Trong `launch()`, **ngay trước** `const ctx = await this.launcher(buildLaunchArgs(profile));`:
```ts
    this.prefsSeeder(profile.userDataDir, {
      blockGeolocation: profile.blockGeolocation,
      doNotTrack: profile.doNotTrack,
    });
```

- [ ] **Step 4 — Chạy** test file + full suite PASS, tsc clean.
- [ ] **Step 5 — Commit** `feat(privacy): seed geo-block/DNT prefs before each launch`.

---

## Task 4: UI toggles trong ProfileForm

**Files:** Modify `src/renderer/components/ProfileForm.tsx` (+ chỗ build CreateProfileInput nếu tách).

- [ ] **Step 1 — Đọc** `ProfileForm.tsx` để theo đúng pattern field hiện có (vd geoip checkbox).
- [ ] **Step 2 — Thêm 2 toggle:** "Chặn định vị (geolocation)" bound `blockGeolocation` (default true), "Do Not Track" bound `doNotTrack` (default false). Đưa vào object tạo/sửa profile gửi qua `api.create`/`api.updateProfile`.
- [ ] **Step 3 — Lưu ý drift:** sửa 2 field này KHÔNG phải identity-impacting (không nằm trong khoá lock) → cho phép sửa cả khi locked, không clear fingerprint. (Khác screen/seed.)
- [ ] **Step 4 — `npx tsc --noEmit -p tsconfig.json` clean.** (Renderer không có unit test — gate = tsc.)
- [ ] **Step 5 — Commit** `feat(privacy): profile form toggles for geo-block + DNT`.

---

## Task 5: IPv6 leak check (best-effort)

**Files:** Modify `src/main/proxy-tester.ts`, `src/main/types.ts`, `src/main/unlinkability.ts`; Test `tests/proxy-tester.test.ts`, `tests/unlinkability.test.ts`.

> Phạm vi: query IPv6-echo qua browser proxied; nếu trả về 1 IPv6 → IPv6 đang reachable (rủi ro leak nếu proxy chỉ IPv4) → cảnh báo để user kiểm. KHÔNG khẳng định chắc leak (cần biết IP thật). DNS true-leak: ngoài phạm vi.

- [ ] **Step 1 — Test thất bại** (`tests/proxy-tester.test.ts`): inject launcher/fetcher giả mô phỏng page trả `{"ip":"2001:db8::1"}` ở `api6.ipify.org` → `result.ipv6 === '2001:db8::1'`. Và case timeout/không IPv6 → `result.ipv6` undefined.
- [ ] **Step 2 — Chạy** FAIL.
- [ ] **Step 3 — Impl:** trong `ProxyTester.test()`, sau khi lấy exit IP (cùng browser/page), thêm best-effort:
```ts
    let ipv6: string | undefined;
    try {
      await page.goto('https://api6.ipify.org?format=json', { timeout: 8000 });
      const raw = await page.evaluate(() => document.body.innerText);
      const got = JSON.parse(raw).ip as string;
      if (got && got.includes(':')) ipv6 = got;
    } catch { /* không reachable = an toàn */ }
```
trả thêm `ipv6` trong result. Thêm `ipv6?: string` vào `ProxyTestResult` + `ProxyCheckSnapshot` (types.ts) + map trong `toProxySnapshot` (identity-service.ts).
- [ ] **Step 4 — Cảnh báo:** trong `unlinkability.ts proxyWarnings`, nếu `p.lastProxyCheck?.ipv6` có giá trị → push `{ level: 'medium', message: 'IPv6 đang lộ ra ngoài — kiểm tra proxy có cover IPv6 không.' }`. Thêm test ở `tests/unlinkability.test.ts`.
- [ ] **Step 5 — Chạy** PASS + tsc clean.
- [ ] **Step 6 — Commit** `feat(proxy): best-effort IPv6 leak visibility + warning`.

---

## Task 6: Fonts-dir wiring (làm nếu user bundle được bộ font Windows ĐẦY ĐỦ — xem §4)

> Mục tiêu thật: **giấu font host cài thêm** (verified Probe C: 20→1) cho mọi profile windows-spoof, bất kể host. Resolver nên yêu cầu **đủ font** (vd ≥50 file) mới bật, tránh sandbox về bộ thưa giả lộ liễu.

**Files:** Create `src/main/fonts-dir.ts`; Modify `src/main/launch-args.ts`, `src/main/browser-manager.ts`, `electron-builder.yml`, `.gitignore`; Test `tests/launch-args.test.ts`.

- [ ] **Step 1 — Test thất bại** (`tests/launch-args.test.ts`): `buildLaunchArgs(profile({platform:'windows'}), '/x/fonts')` → args chứa `--fingerprint-fonts-dir=/x/fonts`. `platform:'macos'` → KHÔNG có. `fontsDir = null` → KHÔNG có.
- [ ] **Step 2 — Chạy** FAIL.
- [ ] **Step 3 — `launch-args.ts`:** đổi chữ ký `export function buildLaunchArgs(p: Profile, fontsDir?: string | null)`. Sau block hardware flags:
```ts
  if (fontsDir && platform === 'windows') {
    args.push(`--fingerprint-fonts-dir=${fontsDir}`);
  }
```
(`platform` đã có sẵn trong hàm.)
- [ ] **Step 4 — `fonts-dir.ts`** (resolver, main-only):
```ts
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/** Path tới bộ font Windows đã bundle (prod: resourcesPath/fonts/windows; dev: build/fonts/windows). null nếu trống. */
export function resolveWindowsFontsDir(): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'fonts', 'windows') : null,
    join(process.cwd(), 'build', 'fonts', 'windows'),
  ].filter((x): x is string => !!x);
  for (const dir of candidates) {
    try {
      if (existsSync(dir) && readdirSync(dir).some((f) => /\.(ttf|ttc|otf)$/i.test(f))) return dir;
    } catch { /* ignore */ }
  }
  return null;
}
```
- [ ] **Step 5 — `browser-manager.ts`:** import `resolveWindowsFontsDir`; truyền vào: `buildLaunchArgs(profile, resolveWindowsFontsDir())`. (Có thể inject để test; mặc định gọi resolver.)
- [ ] **Step 6 — `electron-builder.yml`:** thêm
```yaml
extraResources:
  - from: build/fonts/windows
    to: fonts/windows
```
- [ ] **Step 7 — `.gitignore`:** thêm `build/fonts/windows/*` và `!build/fonts/windows/.gitkeep`; tạo file rỗng `build/fonts/windows/.gitkeep`.
- [ ] **Step 8 — Chạy** test PASS + tsc clean.
- [ ] **Step 9 — Commit** `feat(fonts): optional --fingerprint-fonts-dir wiring (user-supplied Windows fonts)`.

> **Nguồn font — KHÔNG commit font MS vào repo (repo PUBLIC → vi phạm license + DMCA).** `build/fonts/windows/` phải gitignore. Hai cách lấy font khi build:
> - **Cách 1 (khuyến nghị): CI copy từ Windows runner.** Trong `release.yml` job `windows-latest`, thêm step copy `C:\Windows\Fonts\*` → `build/fonts/windows/` trước `electron-builder`; `upload-artifact` rồi job macOS `download-artifact` để bundle vào dmg. Font không nằm repo. (App phát hành vẫn chứa font MS = vùng xám redistribute — rủi ro user chấp nhận.)
> - **Cách 2 (zero rủi ro license): font open metric-compatible** — Liberation Sans/Serif/Mono, Carlito (≈Calibri), Caladea (≈Cambria), Selawik (≈Segoe UI, OFL). Commit được. NHƯNG enumerate ra TÊN thay thế (`Carlito`≠`Calibri`) → spoof tên font yếu hơn.
> Verify bằng diagnostics: font host (Menlo/Monaco/SF Pro trên Mac, hay font cài thêm trên Win) phải rớt, thay bằng bộ bundle.

---

## Task 7: Docs + verify tổng

- [ ] **Step 1 — `docs/TECHNICAL.md` §9:** cập nhật: Geo = block qua Preferences (đã verify; match hỏng trên Mac); DNT toggle; IPv6 = cảnh báo best-effort; Fonts = fonts-dir tùy chọn (giấu font host, cần user cấp font). DNS true-leak = ngoài phạm vi.
- [ ] **Step 2 — `docs/antidetect-multi-profile-stability-audit.md`:** đánh dấu các mục đã xử lý.
- [ ] **Step 3 — Verify:** `npx vitest run` (tất cả PASS) + `npx tsc --noEmit -p tsconfig.json` clean + `npx electron-vite build` OK.
- [ ] **Step 4 — (tùy chọn) Verify thực tế:** mở 1 profile, kiểm `navigator.doNotTrack` + geolocation bị denied; nếu làm Task 6, chạy diagnostics so font trước/sau.
- [ ] **Step 5 — Commit** `docs(privacy): update fingerprint hardening status`.

---

## Out of scope (ghi rõ)
- **DNS true leak-test:** cần server callback log resolver IP hoặc API ngoài (proxycheck/bash.ws). Không làm offline. Để sau nếu user muốn cắm API.
- **Canvas/Audio trên macOS:** giới hạn binary 25-patch, không vá ở app. Account giá trị cao → Windows. Dùng diagnostics để kiểm collision.
- **Match geolocation theo city:** loại bỏ — `--fingerprint-location` không chạy trên binary Mac (Probe A).

## Self-review
- Coverage: Geo(block)=T1-4, DNT=T1-4, IPv6=T5, Fonts=T6, docs=T7. ✅
- Tất cả task có code/test cụ thể, không placeholder.
- Type nhất quán: `seedChromePreferences(userDataDir, {blockGeolocation, doNotTrack})`, `buildLaunchArgs(p, fontsDir?)`, `resolveWindowsFontsDir()`, field `blockGeolocation`/`doNotTrack`/`ipv6`.
- ⚠️ Trước Task 6: hỏi user môi trường deploy (§4).
