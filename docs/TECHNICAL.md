# Tài liệu kỹ thuật — CloakBrowser Manager

Phiên bản tài liệu: 2026-06-18 · App: v0.2.x

---

## 1. Bài toán

Quản lý **nhiều tài khoản** trên cùng một nền tảng đòi hỏi nhiều phiên trình duyệt độc lập từ một máy. Nền tảng chống multi-account bằng cách **liên kết các phiên** qua nhiều tín hiệu. Yêu cầu số 1 của dự án: **cross-instance unlinkability** — nhiều cửa sổ Chrome mở cùng lúc trên một máy không được phép bị nhận ra là cùng nguồn.

Ràng buộc:
- Cửa sổ Chrome **thật, headed**, người dùng thao tác tay (không automation).
- Đóng gói được thành `.exe` / `.dmg` gửi sang máy khác (Windows + macOS).
- Phiên đăng nhập **bền** giữa các lần mở.

## 2. Giải pháp tổng thể

Engine: **cloakbrowser** — Chromium vá ở tầng C++ (58 patch), điều khiển qua Playwright. App chỉ làm lớp quản lý: sinh/giữ tham số chống nhận diện cho từng profile, mở `launchPersistentContext`, và canh giữ tính nhất quán danh tính (identity lock).

```
┌───────────────────────────── Electron ─────────────────────────────┐
│  Main process (Node)                                                │
│    ProfileStore (lowdb JSON)   ── CRUD + migrate + identity lock     │
│    BrowserManager              ── launch/stop, probe, lock, openUrl  │
│    IdentityService             ── proxy check, drift detection       │
│    ProxyTester                 ── kiểm IP exit qua proxy             │
│    launch-args                 ── Profile → cờ Chromium (lõi)        │
│    updater                     ── kiểm GitHub Release                │
│         ▲ IPC (contextBridge preload)                               │
│  Renderer (React, cô lập)  ── ProfileList / Form / FingerprintPanel │
└─────────────────────────────────────────────────────────────────────┘
        │ launchPersistentContext (headed)
        ▼
   cloakbrowser (Chromium stealth)  ←─ tải runtime về ~/.cloakbrowser
```

- **Main process** giữ toàn bộ logic & bí mật; **renderer** chạy `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (bắt buộc cho ESM preload).
- Lưu trữ: **lowdb (JSON)** tại `app.getPath('userData')/cloak.json` — chọn JSON thay SQLite để tránh native module, đóng gói cross-platform dễ.
- Mỗi profile có `userDataDir` riêng → cookie/localStorage/cache cô lập hoàn toàn.

## 3. Mô hình dữ liệu (`Profile`)

```ts
Profile {
  id, name, seed,                       // seed cố định = danh tính fingerprint
  platform: 'windows' | 'macos',
  proxy: { type, host, port, user?, pass? } | null,
  geoip, timezone, locale, startUrl,
  userDataDir,                          // phiên bền, riêng từng profile
  fingerprint, visitorId,               // đo ở lần mở đầu
  identityLocked, resolvedIdentity,     // khoá danh tính (mục 6)
  lastProxyCheck,                       // cache kết quả proxy (TTL 10')
  createdAt, lastOpenedAt
}
```

Migration: `store.migrate()` (SCHEMA_VERSION) tự bù field mới cho profile tạo từ bản cũ → **data cũ vẫn chạy sau khi update app**.

## 4. Lõi chống nhận diện (`launch-args.ts`)

`buildLaunchArgs(profile)` → tham số cho `launchPersistentContext`:

```ts
args: [
  `--fingerprint=${seed}`,                         // bộ fingerprint nhất quán theo seed
  `--fingerprint-platform=${platform}`,            // windows | macos
  '--ignore-gpu-blocklist',                        // headed cần để WebGL chạy
  ...(proxy && !geoip ? ['--fingerprint-webrtc-ip=auto'] : []),
]
stealthArgs: false,   // bỏ default của cloakbrowser (gồm --no-sandbox, không cần trên desktop)
proxy, geoip, timezone, locale, headless: false
```

- `geoip: true` (mặc định khi có proxy) tự khớp timezone/locale theo IP exit **và** tự inject `--fingerprint-webrtc-ip`. Cần `mmdb-lib` + DB GeoLite2 (cloakbrowser tự tải).
- Override `timezone`/`locale` thủ công sẽ thắng geoip.

## 5. Đo & theo dõi fingerprint

- Lần mở đầu: điều hướng tới origin trung lập (`example.com`), đọc `navigator/screen/WebGL` (`captureFingerprint`) và tính **FingerprintJS v4 visitorId** (`captureVisitorId`, best-effort, cần mạng). Lưu vào DB, hiển thị read-only.
- Nút **Test FP** mở trang kiểm tra (browserleaks…) ngay trong profile.
- **Đổi seed** xoá fingerprint+visitorId, đo lại ở lần mở kế.

## 6. Identity lock & drift detection (`IdentityService`)

Vấn đề: proxy đổi IP, cập nhật binary, hay sửa cấu hình giữa chừng làm danh tính "trôi" → nền tảng nghi ngờ. Cơ chế:

- **Lock:** sau lần mở đầu thành công (có proxy + fingerprint), chốt `resolvedIdentity` = { seed, platform, proxy, exitIp, cloakBrowserVersion, timezone, locale, fingerprint, visitorId }.
- **Preflight (mở lần sau):** so sánh hiện tại với bản khoá: seed, platform, proxy, timezone, locale, version, và **exit IP** (đo lại qua proxy, cache TTL 10'). Lệch → ném `IdentityDriftError`, **chặn mở**.
- **Dung sai IP:** `sameIpScope()` coi cùng `/24` là cùng danh tính (proxy residential sticky hay đổi octet cuối) → tránh báo nhầm.
- **forceLaunch ("chấp nhận IP mới"):** re-align bản khoá theo môi trường hiện tại (exit IP, version), **giữ** seed/fingerprint/cookie — lựa chọn an toàn thay vì reset hẳn.

## 7. Cảnh báo unlinkability (`unlinkability.ts`)

- `level: high` — profile **không proxy** (dùng IP máy chủ).
- `level: medium` — **trùng host proxy** với profile khác (cùng IP).

Hiển thị badge cảnh báo trên từng card.

## 8. Đóng gói & cập nhật

- `electron-builder`: `.dmg` (arm64 + x64), `.exe` (NSIS x64). `appId` cố định `com.cloakbrowser.manager` → userData ổn định qua các bản → **giữ data**.
- **CI (GitHub Actions):** build trên runner macOS + Windows **thật**, gộp artifact, publish 1 release theo tag. ⚠️ Build `.exe` NSIS từ macOS (Wine) tạo installer hỏng ("integrity check failed") → bắt buộc build trên Windows runner.
- **Update:** `updater.checkForUpdate()` so version app với GitHub Release mới nhất (repo public, không cần token); có bản cao hơn → banner. Không auto-install (cần code-sign/notarize).

## 9. Hạn chế (đầy đủ, đã kiểm chứng)

### 9.1 macOS — canvas không đa dạng hoá theo seed ⚠️ (quan trọng nhất)
Đã đo thực nghiệm trên macOS: `--fingerprint=<seed>` làm **WebGL renderer đổi** theo seed (RTX/Apple GPU khác nhau) nhưng **canvas-2D hash GIỐNG HỆT** ở mọi seed, mọi render path (GPU / `--disable-gpu` / SwiftShader). Trên **Windows thì canvas đổi đúng**. → Đây là giới hạn của binary cloakbrowser bản macOS, không sửa được ở tầng app.

Hệ quả & sắc thái:
- FingerprintJS **visitorId vẫn khác nhau** giữa các profile trên macOS (vì tổng hợp WebGL/audio/fonts… khác) → đa số fingerprinting thương mại vẫn coi là thiết bị khác.
- Nhưng tracker **chuyên hash canvas thô** (vd tab Canvas của browserleaks) sẽ thấy chung → có thể liên kết.
- **Khuyến nghị: vận hành account giá trị cao trên Windows.** macOS dùng cho dev/test hoặc rủi ro thấp.

### 9.2 Trục không điều khiển được theo seed
`hardwareConcurrency` (kẹt ~8), `deviceMemory`, độ phân giải màn hình — không có flag trong cloakbrowser 0.3.31. Là giá trị phổ biến nên ít làm profile nổi bật, nhưng không biến thiên giữa các profile.

### 9.3 Font enumeration
Patch canvas noise theo seed, nhưng JS enumerate font vẫn phản ánh font OS thật → tín hiệu liên kết tiềm tàng giữa các profile cùng máy.

### 9.4 Ký số
Chưa code-sign (Windows) / notarize (macOS) → SmartScreen / Gatekeeper cảnh báo. Cần Apple Developer (~$99/năm) + cert Windows để hết.

### 9.5 Ngoài phạm vi trình duyệt
App chỉ lo **browser fingerprint + IP isolation**. Với marketplace (Redbubble, …) các vector link account mạnh nhất thường là **danh tính thanh toán/tax, địa chỉ, nội dung upload trùng, email/hành vi** — nằm ngoài tầm của app. Anti-detect hoàn hảo cũng không cứu nếu dùng chung payout hoặc upload design giống nhau.

### 9.6 visitorId & test phụ thuộc mạng
Đo FingerprintJS cần tải module từ CDN + origin không chặn CSP; offline thì bỏ qua (best-effort).

## 10. Kiểm thử
Unit (Vitest): `launch-args`, `unlinkability`, `store` (+migrate/regenerate), `fingerprint-probe`, `browser-manager`, `proxy-tester`, `proxy-parse`, `identity-service`, `quarantine`. Integration (`tests/integration`, loại khỏi run mặc định): mở 2 profile seed khác nhau → assert fingerprint khác + `webdriver=false`.

## 11. Bảo mật & vận hành
- Renderer cô lập, không truy cập Node trực tiếp; mọi thao tác qua IPC có kiểm soát.
- Quá trình mở: clear quarantine binary (macOS), startup state machine chặn UI cho tới khi service sẵn sàng.
- Khuyến nghị vận hành: 1 proxy residential / profile, không đăng nhập chéo, payout/email/nội dung tách biệt từng account.
