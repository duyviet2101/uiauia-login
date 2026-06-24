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
  blockGeolocation, doNotTrack,         // quyền riêng tư qua Chrome Preferences (mục 4.2)
  userDataDir,                          // phiên bền, riêng từng profile
  fingerprint, visitorId,               // đo ở lần mở đầu
  identityLocked, resolvedIdentity,     // khoá danh tính (mục 6)
  lastProxyCheck,                       // cache kết quả proxy (TTL 10') + cờ ipv6 nếu lộ
  createdAt, lastOpenedAt
}
```

Migration: `store.migrate()` (SCHEMA_VERSION) tự bù field mới cho profile tạo từ bản cũ → **data cũ vẫn chạy sau khi update app**.

## 4. Lõi chống nhận diện (`launch-args.ts`)

`buildLaunchArgs(profile, display?)` → tham số cho `launchPersistentContext`:

```ts
args: [
  `--fingerprint=${seed}`,                         // bộ fingerprint nhất quán theo seed
  `--fingerprint-platform=${platform}`,            // windows | macos
  '--ignore-gpu-blocklist',                        // headed cần để WebGL chạy
  // Phần cứng theo từng profile (derive từ seed) — xem mục 4.1
  `--fingerprint-screen-width=${w}`, `--fingerprint-screen-height=${h}`,
  `--fingerprint-hardware-concurrency=${cores}`,
  ...(deviceMemory ? [`--fingerprint-device-memory=${deviceMemory}`] : []),
  ...(proxy && !geoip ? ['--fingerprint-webrtc-ip=auto'] : []),
  // KHÔNG có --fingerprint-fonts-dir: no-op trên Windows DirectWrite (mục 4.2/9.3)
]
stealthArgs: false,   // bỏ default của cloakbrowser (gồm --no-sandbox, không cần trên desktop)
proxy, geoip, timezone, locale, headless: false
```

### 4.1 Phần cứng theo từng profile (`deriveHardwareProfile`)

Binary mặc định để `screen` (1920×1080 Win / 1440×900 Mac), `hardwareConcurrency` (8), `deviceMemory` (8) **giống hệt nhau ở mọi seed** → nhiều profile trên cùng 1 máy dùng chung các giá trị này = vector liên kết same-device. `deriveHardwareProfile(seed, platform)` chọn **deterministic theo seed** một bộ (độ phân giải từ pool theo OS, cores ∈ {4,6,8,12,16}, RAM ∈ {4,8}) rồi truyền explicit. Vì seed cố định → giá trị ổn định giữa các lần mở, nhưng **khác nhau giữa các profile**.

- **Profile đã có fingerprint** (đã khoá, hoặc đã probe lần mở trước): **tái dùng đúng giá trị cũ** từ `fingerprint`/`resolvedIdentity` — account đã "ấm" không bao giờ bị đổi thiết bị. Chỉ profile **mới tinh** mới derive từ seed.
- Đã kiểm chứng trên binary macOS 25-patch: explicit flag **được tôn trọng** (screen/cores đổi đúng theo profile). Riêng **canvas/audio không có flag** → vẫn là giới hạn (mục 9.1).

- `geoip: true` (mặc định khi có proxy) tự khớp timezone/locale theo IP exit **và** tự inject `--fingerprint-webrtc-ip`. Cần `mmdb-lib` + DB GeoLite2 (cloakbrowser tự tải).
- Override `timezone`/`locale` thủ công sẽ thắng geoip.

### 4.2 Quyền riêng tư & font sandbox

Hai cơ chế chạy **trước launch**, ghi vào Chrome thật (không phải JS hack):

- **Geo-block + DNT (`browser-preferences.ts`):** seed `Default/Preferences` idempotent trước mỗi lần mở (gộp chung với việc set search provider / restore session, một lần ghi atomic). `blockGeolocation` → `profile.default_content_setting_values.geolocation = 2` (mọi yêu cầu vị trí bị **denied** — triệt tiêu rò vị trí thật qua WiFi-AP khi user lỡ bấm Allow); `doNotTrack` → `enable_do_not_track`. Đã kiểm chứng 2026-06-22: pref thật, undetectable. Mặc định geo-block **ON**, DNT **OFF** (off giống số đông hơn). Hai field này **không** identity-impacting → sửa được cả khi profile đã khoá.
- **Font leak detect + warn (`host-fonts.ts` + diagnostics):** `--fingerprint-fonts-dir` **đã loại** — chứng minh trên 0.4.1 là **no-op trên Windows** (DirectWrite vẫn enumerate font host; bundle bỏ 4 họ font không làm width-probe đổi). Vì binary đóng không cho font biến thiên theo profile, font host (kể cả user cài thêm) lộ **giống hệt** ở mọi profile = vector liên kết. Thay vì sandbox bất khả thi, ta **phát hiện & cảnh báo**: probe (`fingerprint-probe.ts`) đo `measureText` trên một **từ điển** = baseline Windows stock ∪ họ non-stock phổ biến; `findNonStandardFonts(detected, baseline)` trả về font ngoài baseline → diagnostics gắn cảnh báo `high` nêu tên thủ phạm (vd "Ubuntu Mono"). Baseline chụp thực nghiệm từ registry HKLM máy sạch (`src/main/font-baseline.ts`, provenance ở `scripts/verify-windows/windows-font-baseline.json`). Font tên tùy biện không có trong từ điển (vd "Tirra") thì cả adversary lẫn ta đều không thấy — đúng giới hạn của width-probe khi `queryLocalFonts` đã bị chặn.
- **Chặn Local Font Access (`local_fonts: 2`, luôn bật):** `queryLocalFonts()` liệt kê được TOÀN BỘ font host (kể cả font user cài thêm) và `--fingerprint-fonts-dir` **không** phủ API này (đã kiểm 2026-06-23: manager trả y hệt Chrome thật — 204 font + font custom). Seed `default_content_setting_values.local_fonts = 2` → quyền bị từ chối, không popup. API luôn cần user-gesture/popup nên rủi ro thấp, chặn cho chắc.

## 5. Đo & theo dõi fingerprint

- Lần mở đầu: đọc local `navigator/screen/WebGL` (`captureFingerprint`) ngay trong page hiện có, **không** điều hướng tới origin trung gian và **không** import FingerprintJS CDN. Lưu snapshot vào DB, hiển thị read-only.
- Nút **Diagnostics** chạy probe local cho `canvas`, `audio` và font availability, lưu hash/summary vào profile để đối chiếu giữa các profile mà không cần mạng.
- Nút **Test FP** mở trang kiểm tra (browserleaks…) ngay trong profile khi người dùng chủ động muốn kiểm tra bằng dịch vụ bên ngoài.
- **Đổi seed** xoá fingerprint+visitorId, đo lại ở lần mở kế.

## 6. Identity lock & drift detection (`IdentityService`)

Vấn đề: proxy đổi IP, cập nhật binary, hay sửa cấu hình giữa chừng làm danh tính "trôi" → nền tảng nghi ngờ. Cơ chế:

- **Lock:** sau lần mở đầu thành công (có proxy + fingerprint), chốt `resolvedIdentity` = { seed, platform, proxy, exitIp, cloakBrowserVersion, timezone, locale, fingerprint, visitorId }.
- **Preflight (mở lần sau):** so sánh hiện tại với bản khoá: seed, platform, proxy, timezone, locale, version, và **exit IP** (đo lại qua proxy, cache TTL 10'). Lệch → ném `IdentityDriftError`, **chặn mở**.
- **Dung sai IP:** `sameIpScope()` coi cùng `/24` là cùng danh tính (proxy residential sticky hay đổi octet cuối) → tránh báo nhầm.
- **forceLaunch ("chấp nhận IP mới"):** re-align bản khoá theo môi trường hiện tại (exit IP, version), **giữ** seed/fingerprint/cookie — lựa chọn an toàn thay vì reset hẳn.

## 7. Cảnh báo unlinkability (`unlinkability.ts`)

- `level: high` — profile **không proxy** (dùng IP máy chủ); exit IP đã khoá bị đổi hoặc trùng với profile khác.
- `level: medium` — **trùng host proxy** với profile khác (cùng IP); cùng ASN/ISP+vị trí; **IPv6 lộ ra ngoài** (đo best-effort qua `api6.ipify.org` lúc test proxy — proxy có thể chỉ cover IPv4, mục 9.7).

Hiển thị badge cảnh báo trên từng card.

## 8. Đóng gói & cập nhật

- `electron-builder`: `.dmg` (arm64 + x64), `.exe` (NSIS x64). `appId` cố định `com.cloakbrowser.manager` → userData ổn định qua các bản → **giữ data**.
- **CI (GitHub Actions):** build trên runner macOS + Windows **thật**, gộp artifact, publish 1 release theo tag. ⚠️ Build `.exe` NSIS từ macOS (Wine) tạo installer hỏng ("integrity check failed") → bắt buộc build trên Windows runner.
- **Update:** `updater.checkForUpdate()` so version app với GitHub Release mới nhất (repo public, không cần token); có bản cao hơn → banner. Không auto-install (cần code-sign/notarize).

## 9. Hạn chế (đầy đủ, đã kiểm chứng)

### 9.1 macOS — canvas & audio không đa dạng hoá theo seed ⚠️ (quan trọng nhất)
**Nguyên nhân gốc:** binary macOS đang ở Chromium **145.0.7632.109.2 = 25 patch fingerprint**, trong khi Windows/Linux ở **146.0.7680.177.5 = 57 patch** (`cloakbrowser/config.py` PLATFORM_CHROMIUM_VERSIONS). Các patch làm canvas/audio biến thiên theo seed nằm trong bản 57-patch, **chưa có ở bản Mac 25-patch**. (npm 0.4.0 — 2026-06-22 — vẫn để Mac ở 145/25 → nâng version npm không cứu được.)

Đã đo thực nghiệm trên macOS (M3): `--fingerprint=<seed>` làm **WebGL renderer đổi** theo seed nhưng **canvas-2D hash VÀ audio hash GIỐNG HỆT** ở mọi seed, và giống cả khi đổi `--fingerprint-platform` windows↔macos. Không có flag canvas/audio → **không sửa được ở tầng app**.

Hệ quả & sắc thái:
- FingerprintJS **visitorId vẫn khác nhau** giữa các profile trên macOS (tổng hợp WebGL/screen/cores/audio… khác) → đa số fingerprinting thương mại vẫn coi là thiết bị khác. Sau khi vary screen/cores (mục 4.1) khoảng cách này càng lớn.
- Nhưng tracker **chuyên hash canvas/audio thô** (vd tab Canvas của browserleaks) sẽ thấy chung → có thể liên kết.
- **Khuyến nghị: vận hành account giá trị cao trên Windows** (binary 57-patch vary cả canvas+audio). macOS dùng cho dev/test hoặc rủi ro thấp.

### 9.2 Trục screen / cores / memory — ĐÃ vary theo profile
**Trước đây:** `hardwareConcurrency`, `deviceMemory`, độ phân giải màn hình kẹt cứng (8 / 8 / 1920×1080) ở mọi seed → dùng chung giữa các profile. (Tài liệu cũ ghi sai là "không có flag trong 0.3.31" — flag `--fingerprint-screen-width/height`, `-hardware-concurrency`, `-device-memory` **có sẵn** trong 0.3.31.)
**Hiện tại:** `deriveHardwareProfile` (mục 4.1) truyền explicit các flag này theo seed → **biến thiên giữa các profile** trên cả Win lẫn Mac. Caveat: `navigator.deviceMemory` đọc ra `null` trên `about:blank` (cần verify trên trang HTTPS thật); flag vẫn được truyền.

### 9.3 Font enumeration — detect + warn (không sandbox được)
Đã xác minh (2026-06-25, binary 146/58): font **không** biến thiên theo profile và **không thể** sandbox phía consumer. `--fingerprint-noise` (per-seed) chỉ phủ canvas/WebGL/audio/clientRects — **không phủ font**; `--fingerprint-fonts-dir` là công cụ additive cho Linux/Docker, **no-op trên Windows DirectWrite** (đã thử: bundle bỏ 4 họ font → width-probe không đổi). Binary đóng (không có Pro license) nên không sửa được tận gốc. → Pipeline fonts-dir **đã gỡ bỏ** (launch-args, `fonts-dir.ts`, `release.yml` job `fonts`, `electron-builder` extraResources, `build/fonts`). Giữ `local_fonts: 2` (chặn `queryLocalFonts`). Thay bằng **detect + warn** (mục 4.2): diagnostics nêu tên font user cài bị lộ giống nhau ở mọi profile; khuyến nghị vận hành là dùng máy **sạch font** cho tài khoản quan trọng. clientRects: đo lại 5 profile → 5/5 khác nhau (noise on mặc định), không phải lỗ hổng.

### 9.4 Ký số
Chưa code-sign (Windows) / notarize (macOS) → SmartScreen / Gatekeeper cảnh báo. Cần Apple Developer (~$99/năm) + cert Windows để hết.

### 9.5 Ngoài phạm vi trình duyệt
App chỉ lo **browser fingerprint + IP isolation**. Với marketplace (Redbubble, …) các vector link account mạnh nhất thường là **danh tính thanh toán/tax, địa chỉ, nội dung upload trùng, email/hành vi** — nằm ngoài tầm của app. Anti-detect hoàn hảo cũng không cứu nếu dùng chung payout hoặc upload design giống nhau.

### 9.6 External fingerprint test phụ thuộc mạng
App không còn tự đo FingerprintJS visitorId trong luồng launch mặc định để tránh tạo network/cache trace không cần thiết. Kiểm tra bằng dịch vụ ngoài chỉ chạy khi người dùng bấm **Test FP**.

### 9.7 Geo / DNT / IPv6 / DNS
- **Geo:** chỉ **chặn** (không match theo city) — `--fingerprint-location` hỏng trên binary Mac 25-patch (Probe A). Chặn qua Preferences (mục 4.2) đủ để không lộ vị trí thật.
- **IPv6:** chỉ **cảnh báo best-effort** (thấy IPv6 reachable qua browser proxied). **Không** khẳng định chắc leak (cần biết IP thật của máy). Proxy chỉ cover IPv4 + còn IPv6 route = rủi ro → user tự kiểm.
- **DNS true leak-test:** **ngoài phạm vi** — cần hạ tầng callback/API ngoài (proxycheck/bash.ws) log resolver IP. Không làm offline; để sau nếu cắm API.

## 10. Kiểm thử
Unit (Vitest): `launch-args`, `unlinkability`, `store` (+migrate/regenerate), `fingerprint-probe`, `browser-manager`, `proxy-tester`, `proxy-parse`, `identity-service`, `quarantine`. Integration (`tests/integration`, loại khỏi run mặc định): mở 2 profile seed khác nhau → assert fingerprint khác + `webdriver=false`.

## 11. Bảo mật & vận hành
- Renderer cô lập, không truy cập Node trực tiếp; mọi thao tác qua IPC có kiểm soát.
- Quá trình mở: clear quarantine binary (macOS), startup state machine chặn UI cho tới khi service sẵn sàng.
- Khuyến nghị vận hành: 1 proxy residential / profile, không đăng nhập chéo, payout/email/nội dung tách biệt từng account.
