# Anti-Detect Browser Profile Manager — Design Spec

- **Ngày**: 2026-06-17
- **Trạng thái**: Approved (design) → chuyển sang implementation plan
- **Nền tảng đích**: Desktop (Windows x64, macOS arm64/x64)
- **Engine**: [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) (stealth Chromium, package npm `cloakbrowser`)

---

## 1. Mục tiêu

Một **app desktop đóng gói được** (gửi file cài `.exe`/`.dmg` đi máy khác, chạy local) để tạo, quản lý và mở nhiều **profile Chrome anti-detect**. User tự tay thao tác trong các cửa sổ Chrome thật (không phải automation).

### Tiêu chí số 1 (ràng buộc cao nhất): Cross-instance unlinkability

> Các nền tảng (Facebook, Google, Amazon...) **không được phép suy ra rằng nhiều cửa sổ Chrome này cùng chạy trên một máy nguồn**. Mỗi profile phải trông như một thiết bị + một người dùng + một mạng khác nhau.

Mọi quyết định thiết kế khác phải phục vụ tiêu chí này. Chi tiết ở Mục 2.

### Tiêu chí phụ
- Ship dễ: một ngôn ngữ (TS), không bundle Python, ít native module.
- MVP tối giản: làm đúng phần lõi, để dành tính năng nâng cao cho v2.
- Mặc định an toàn: user không cần hiểu fingerprint vẫn được bảo vệ ở mức cao nhất.

---

## 2. Cross-instance unlinkability — phân tích vector & cách chặn

Đây là phần quan trọng nhất của spec. Liệt kê từng tín hiệu mà nền tảng dùng để **liên kết (link) các tài khoản/instance về cùng một nguồn**, và cách app + CloakBrowser chặn.

| # | Vector liên kết | Rủi ro nếu không xử lý | Cách chặn trong app |
|---|---|---|---|
| 1 | **Địa chỉ IP** | Tín hiệu mạnh nhất. Cùng IP công cộng = gần như chắc chắn cùng nguồn | **Mỗi profile một proxy riêng** (residential khuyến nghị). App cảnh báo (không chặn) khi 2 profile dùng trùng host proxy. Profile không proxy bị đánh dấu "rủi ro cao — chia sẻ IP máy chủ" |
| 2 | **WebRTC IP leak** | Lộ IP thật/LAN qua ICE candidate dù đã có proxy | `--fingerprint-webrtc-ip=auto` (resolve exit IP của proxy), **auto bật khi geoip bật**. Khi có proxy mà không geoip → app vẫn tự thêm `--fingerprint-webrtc-ip=auto` |
| 3 | **Timezone / Locale mismatch** | IP ở Mỹ nhưng timezone Asia/HCM = cờ bot, và khớp tz giữa nhiều profile cùng = dấu hiệu liên kết | `geoip: true` mặc định khi có proxy → tz + locale khớp exit IP từng proxy. Override thủ công nếu cần |
| 4 | **Fingerprint phần cứng** (canvas, WebGL, audio, GPU, screen, CPU, RAM, clientRects) | Cùng fingerprint = cùng máy | **Mỗi profile một `seed` ngẫu nhiên, cố định** → CloakBrowser sinh bộ fingerprint nhất quán & khác nhau cho từng profile. Seed lưu DB, không random lại |
| 5 | **Cookie / localStorage / cache rò rỉ chéo** | Cookie tracking liên kết tài khoản | Mỗi profile một `userDataDir` **riêng biệt** (persistent context). Không bao giờ dùng chung |
| 6 | **Storage quota / incognito signal** | Profile rỗng/incognito bị nghi | Persistent context (không incognito). Mặc định quota normalize để qua FingerprintJS (xem Mục 9 tradeoff) |
| 7 | **Danh sách font hệ thống** | Tất cả profile trên cùng máy enumerate **cùng tập font OS thật** → tín hiệu liên kết tiềm tàng | CloakBrowser noise canvas-based font measurement theo seed. **Hạn chế đã biết**: JS font enumeration vẫn phản ánh font OS thật. Ghi nhận ở Mục 11 (Rủi ro). Không cố giải trong MVP |
| 8 | **TLS / HTTP2 fingerprint (JA3/JA4)** | Có thể nhận diện client | CloakBrowser khớp y hệt Chrome thật → entropy thấp, **không** phải vector liên kết giữa các profile (mọi Chrome đều giống). Không cần xử lý |
| 9 | **Platform mismatch** | navigator.platform vs UA vs GPU không khớp = lộ | Giữ **native platform** của host (Win profile trên máy Win). CloakBrowser sinh GPU/UA khớp platform từ seed. Không spoof cross-platform ở MVP để tránh mismatch |
| 10 | **Thứ tự/đồng thời truy cập (correlation)** | Mở nhiều profile cùng lúc, cùng nhịp hành vi | Ngoài tầm fingerprint — là vấn đề vận hành của user. App **không** ép, nhưng tài liệu khuyến nghị giãn thời gian. Không xử lý kỹ thuật ở MVP |
| 11 | **DNS leak** | DNS resolve ngoài proxy lộ ISP thật | SOCKS5 proxy tunnel DNS; với HTTP proxy CloakBrowser route qua proxy. Khuyến nghị SOCKS5 trong UI hint |

### Nguyên tắc rút ra cho UI
- **Phơi ra cho user chỉnh**: proxy (per-profile, bắt buộc về mặt khuyến nghị), geoip, timezone/locale override. Đây là các trục *phải khác nhau* giữa profile.
- **Để CloakBrowser tự lo (mặc định tốt nhất)**: toàn bộ fingerprint kỹ thuật theo seed. Cho user chỉnh tay các giá trị này dễ tạo **mismatch làm lộ bot** → MVP chỉ hiển thị read-only.
- **Cảnh báo chủ động**: profile không proxy, hoặc trùng host proxy với profile khác.

---

## 3. Phạm vi

### Trong MVP
- CRUD profile (tạo / sửa / xoá / nhân bản).
- Mở (headed) / Dừng từng profile; theo dõi trạng thái running/stopped.
- Mỗi profile: `seed` cố định, proxy, geoip, timezone/locale override, `userDataDir` riêng, session bền.
- Cấu hình & **test proxy** (lấy IP/quốc gia thật qua proxy trước khi mở).
- **Hiển thị read-only** các giá trị fingerprint mà CloakBrowser sinh ra (đọc lại sau lần mở đầu).
- Cảnh báo unlinkability (no-proxy / trùng proxy).
- Đóng gói `.exe` (Windows) + `.dmg` (macOS).

### Ngoài MVP (để v2)
- Chỉnh tay fingerprint (GPU/screen/CPU/RAM...).
- Import/export cookie JSON; sync cookie/tab.
- Groups/tags, nền tảng, username/password/2FA, ghi chú, URL tùy chỉnh.
- Mobile/tablet emulation; multi-kernel; chọn version trình duyệt tùy ý.
- Proxy API/rotation; quản lý kho proxy.
- humanize (chỉ cần khi automation — user thao tác tay nên không cần).
- noVNC/server mode (app chạy local, cửa sổ hiện thẳng).

---

## 4. Kiến trúc (Electron thuần)

```
┌──────────────────────────────────────────────────┐
│  Electron App                                      │
│                                                    │
│  ┌──────────────┐   IPC    ┌────────────────────┐  │
│  │ Renderer      │ ◄──────► │ Main process (Node)│  │
│  │ React + Vite  │ preload  │                    │  │
│  │ + Tailwind    │ (bridge) │ ProfileStore       │  │
│  │ (no node)     │          │ BrowserManager     │  │
│  └──────────────┘          │ FingerprintProbe   │  │
│                            │ ProxyTester        │  │
│                            └─────────┬──────────┘  │
└────────────────────────────────────┼─────────────┘
                                      │ cloakbrowser JS
                                      ▼
                  ┌────────────────────────────────┐
                  │ Cửa sổ Chrome thật (headed)     │ ◄── user thao tác tay
                  │ 1 persistent context / profile  │
                  └────────────────────────────────┘
```

- **Main process** sở hữu toàn bộ logic + truy cập filesystem/network. Renderer hoàn toàn cách ly (`contextIsolation: true`, `nodeIntegration: false`).
- Giao tiếp qua `preload.ts` expose API có kiểu (`window.api.*`) → `ipcRenderer.invoke` → handler trong main.
- Cửa sổ Chrome là process OS độc lập do binary CloakBrowser bật ra.

---

## 5. Tech stack

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Shell | Electron | Cửa sổ native, electron-builder xuất installer chín |
| Ngôn ngữ | TypeScript | Một ngôn ngữ toàn bộ |
| UI | React + Vite + Tailwind | Mượn pattern frontend CloakBrowser-Manager |
| Browser engine | `cloakbrowser` (npm) + `playwright-core` | API headed + persistent context + stealth |
| Lưu trữ | **lowdb (JSON file)** | Tránh native module (better-sqlite3 cần rebuild per-OS → đau đóng gói). Lên SQLite ở v2 nếu cần |
| Đóng gói | electron-builder | `.exe` (NSIS) + `.dmg` |
| Test | Vitest | Unit + integration |

---

## 6. Mô hình dữ liệu

`userData/cloak.json` (lowdb):

```ts
interface Profile {
  id: string;            // uuid
  name: string;
  seed: number;          // sinh 1 lần, cố định → giữ fingerprint
  proxy: ProxyConfig | null;
  geoip: boolean;        // default true khi có proxy
  timezone: string | null;   // override; null = auto/geoip
  locale: string | null;     // override; null = auto/geoip
  userDataDir: string;       // absolute, dưới userData/profiles/<id>
  fingerprint: Fingerprint | null;  // read-back sau lần mở đầu
  createdAt: string;     // ISO
  lastOpenedAt: string | null;
}

interface ProxyConfig {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

interface Fingerprint {        // đọc lại từ browser, read-only
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
  webdriver: boolean;          // kỳ vọng = false (sanity check)
  capturedAt: string;
}
```

- `status` (running/stopped) là runtime trong `BrowserManager`, KHÔNG persist.
- Vị trí: `app.getPath('userData')/cloak.json` + `app.getPath('userData')/profiles/<id>/` cho từng `userDataDir`.

---

## 7. Components (main process)

Mỗi component một file, một trách nhiệm rõ ràng, test độc lập được.

### 7.1 `ProfileStore` (`store.ts`)
- Wrap lowdb. CRUD profile, sinh seed ngẫu nhiên (`crypto`, 10000–99999999), tạo `userDataDir`.
- `duplicateProfile(id)` → copy record với **seed mới + userDataDir mới** (nhân bản không được trùng danh tính).
- Helper: `findProxyConflicts()` → trả profile dùng trùng host:port (cho cảnh báo unlinkability).
- Phụ thuộc: lowdb, fs, Electron `app.getPath`.

### 7.2 `BrowserManager` (`browser-manager.ts`)
- `Map<profileId, { context: BrowserContext; pid?: number }>`.
- `launch(profile)`: build options (Mục 8) → `launchPersistentContext` → lưu vào map → nếu `fingerprint==null` chạy probe (7.4) → bắt event `context.on('close')` để set stopped + emit cho renderer.
- `stop(profileId)`: `context.close()`.
- `isRunning(profileId)`, `runningIds()`.
- Phụ thuộc: `cloakbrowser`, ProfileStore (để cập nhật `fingerprint`, `lastOpenedAt`).

### 7.3 `ProxyTester` (`proxy-tester.ts`)
- `test(proxy)`: mở context tạm qua proxy, gọi `https://api.ipify.org?format=json` + geo lookup → trả `{ ok, ip, country, latencyMs, error? }`.
- Dùng cho nút "Test proxy" và (tùy chọn) kiểm tra trước khi mở.
- Phụ thuộc: `cloakbrowser` (launch nhẹ, headless để test nhanh).

### 7.4 `FingerprintProbe` (`fingerprint-probe.ts`)
- `capture(context)`: mở page tạm `about:blank`, `page.evaluate()` đọc các trường ở `Fingerprint`, đóng page, trả object.
- Tách riêng để test parsing độc lập (inject một fake `window`/evaluate result).

### 7.5 `buildLaunchArgs` (`launch-args.ts`)
- Hàm thuần: `(profile) => LaunchPersistentContextOptions`. Trái tim anti-detect (Mục 8). **Test kỹ nhất.**
- Không side-effect → unit test dễ.

### 7.6 IPC layer (`ipc.ts` + `preload.ts`)
- Channels: `profiles:list/create/update/delete/duplicate`, `browser:launch/stop/status`, `proxy:test`, `profile:get-fingerprint`.
- Main đẩy event `browser:status-changed` xuống renderer khi profile dừng (do user đóng cửa sổ).

---

## 8. Luồng mở — `buildLaunchArgs` (anti-detect mặc định cao nhất)

```ts
function buildLaunchArgs(p: Profile): LaunchPersistentContextOptions {
  const args = [`--fingerprint=${p.seed}`];

  // WebRTC: chống lộ IP thật. geoip=true đã tự inject --fingerprint-webrtc-ip,
  // nên chỉ thêm tay khi có proxy mà geoip tắt (tránh trùng cờ).
  if (p.proxy && !p.geoip) args.push('--fingerprint-webrtc-ip=auto');

  return {
    userDataDir: p.userDataDir,
    headless: false,                  // headed: user thao tác + stealth tốt hơn
    proxy: p.proxy ? toProxyUrl(p.proxy) : undefined,
    geoip: p.proxy ? p.geoip : false, // geoip chỉ có nghĩa khi có proxy
    timezone: p.timezone ?? undefined, // override đè geoip
    locale: p.locale ?? undefined,
    args,
  };
}
```

Quy tắc ưu tiên anti-detect:
1. Có proxy → `geoip=true` (trừ khi user tắt) → tz/locale khớp exit IP + tự thêm `--fingerprint-webrtc-ip=auto`.
2. Override tz/locale thủ công luôn thắng geoip.
3. Native platform (không spoof cross-platform) → GPU/UA/screen khớp từ seed.
4. Không `humanize` (user thao tác tay).
5. `BrowserManager` bắt `context.close` → đồng bộ status.

> Ghi chú đóng gói: trên macOS sau khi `ensureBinary()`, app chạy `xattr -cr <binaryPath>` để clear quarantine (tránh Gatekeeper chặn). Xem Mục 10.

---

## 9. Luồng hiển thị fingerprint sinh ra

1. Lần mở đầu của profile (khi `profile.fingerprint == null`):
   - Sau `launchPersistentContext`, `FingerprintProbe.capture()` mở tab tạm, đọc giá trị, đóng tab.
   - Lưu vào `profile.fingerprint`, persist.
2. UI hiện bảng **read-only**: UA, platform, CPU cores, RAM, languages, screen, DPR, WebGL vendor/renderer, timezone, webdriver (phải = false).
3. Lần mở sau bỏ qua probe.

**Storage-quota tradeoff** (ghi nhận, không cho chỉnh ở MVP): mặc định binary normalize quota để qua FingerprintJS, đổi lại bị một số dịch vụ gắn cờ incognito. MVP giữ mặc định (ưu tiên qua FingerprintJS). Cho chỉnh ở v2.

---

## 10. Đóng gói & phân phối

- `electron-builder`: target `nsis` (Win) + `dmg` (mac, cả arm64 và x64).
- **Native module**: chọn lowdb để **không có** native module → đóng gói cross-platform không cần rebuild. (Nếu sau này dùng better-sqlite3 phải thêm `electron-rebuild` + build trên từng OS.)
- **Binary CloakBrowser (~200MB)**: tự tải lần đầu mỗi máy qua `ensureBinary()`. Hiện progress trong UI lúc khởi động lần đầu / lần mở profile đầu tiên.
- **macOS**:
  - App tự chạy `xattr -cr` lên binary sau tải để qua Gatekeeper.
  - Để gửi máy Mac khác không cảnh báo cần **Apple Developer ID** ($99/năm) để sign + notarize app. Bản dùng thử: hướng dẫn tester chuột phải → Open.
- **Windows**: chưa code-sign → SmartScreen cảnh báo (chấp nhận khi thử nghiệm); v2 cân nhắc mua cert.

---

## 11. Rủi ro & hạn chế đã biết

| Rủi ro | Mức | Ghi chú / giảm thiểu |
|---|---|---|
| **Font enumeration** lộ cùng tập font OS giữa các profile (vector liên kết #7) | Trung bình | CloakBrowser noise canvas font; JS enum vẫn theo OS. Theo dõi; v2 cân nhắc font-dir riêng per-profile |
| Quên đặt proxy → nhiều profile chia sẻ IP máy chủ | Cao | App cảnh báo rõ ràng; đánh dấu profile no-proxy "rủi ro cao" |
| Trùng host proxy giữa profile | Cao | `findProxyConflicts()` cảnh báo |
| macOS signing để phân phối | Trung bình | Cần Developer ID; tài liệu hoá workaround cho bản thử |
| Binary ~200MB tải lần đầu cần mạng | Thấp | Hiện progress; v2 cân nhắc pre-bundle |
| Behavioral correlation (mở đồng thời cùng nhịp) | Ngoài tầm MVP | Tài liệu khuyến nghị vận hành |
| macOS arm64/x64 chỉ có Chromium 145 / 26 patches (so với 146/58 ở Win/Linux) | Thấp | Vẫn pass test; ghi nhận khác biệt platform |

---

## 12. Testing

- **Unit**:
  - `buildLaunchArgs` — mọi tổ hợp proxy/geoip/override → đúng args (đặc biệt: có proxy luôn có `--fingerprint-webrtc-ip=auto`; override tz đè geoip). **Quan trọng nhất.**
  - `toProxyUrl` — http/socks5, có/không credential, encode đặc biệt.
  - `findProxyConflicts` — phát hiện trùng host:port.
  - `FingerprintProbe` parse — từ object evaluate giả → `Fingerprint` đúng.
  - `ProfileStore.duplicateProfile` — seed mới + userDataDir mới (không trùng danh tính).
- **Integration** (chạy binary thật, có thể gắn cờ `@slow`):
  - Mở 1 profile → capture fingerprint → assert `webdriver === false`.
  - Mở 2 profile seed khác nhau → assert WebGL renderer / canvas-derived value khác nhau (chứng minh unlinkability fingerprint).
  - (Nếu có proxy test) `ProxyTester.test` trả IP khác IP máy thật.

---

## 13. Cấu trúc thư mục dự kiến

```
uiauia-login/
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main/
│   │   ├── index.ts            # entry main process, tạo BrowserWindow
│   │   ├── store.ts            # ProfileStore (lowdb)
│   │   ├── browser-manager.ts  # BrowserManager
│   │   ├── launch-args.ts      # buildLaunchArgs + toProxyUrl
│   │   ├── fingerprint-probe.ts
│   │   ├── proxy-tester.ts
│   │   ├── ipc.ts              # đăng ký IPC handlers
│   │   └── types.ts
│   ├── preload/
│   │   └── preload.ts          # contextBridge → window.api
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/         # ProfileList, ProfileForm, FingerprintPanel, ProxyTestButton
│       └── api.ts              # typed wrapper quanh window.api
└── docs/superpowers/specs/2026-06-17-antidetect-browser-manager-design.md
```

---

## 14. Tiêu chí hoàn thành MVP

- Tạo ≥2 profile, mỗi cái proxy khác nhau, mở đồng thời → cửa sổ Chrome thật hiện ra, thao tác tay được.
- Mỗi profile hiện bảng fingerprint read-only với giá trị khác nhau giữa các profile; `webdriver=false`.
- Đóng cửa sổ → app cập nhật status stopped.
- Cảnh báo hiện khi profile không proxy / trùng proxy.
- `npm run build` xuất được `.exe` và `.dmg`.
- Kiểm chứng anti-detect: mở 2 profile, chạy thử trên một site detection (vd browserscan.net / fingerprint demo) → 2 profile cho fingerprint + IP khác nhau, không bị gắn "bot".
