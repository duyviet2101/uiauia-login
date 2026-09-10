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
  baseline,                             // fingerprint ĐÃ CHẤP NHẬN + acceptedAt/engineVersion/schemaVersion/source
  lastObservation,                      // fingerprint ĐO ĐƯỢC ở lần mở gần nhất (mục 5.1)
  diagnostics,                          // lần chạy diagnostics ĐẦY ĐỦ gần nhất
  visitorId,
  identityLocked, resolvedIdentity,     // khoá danh tính (mục 6)
  lastProxyCheck,                       // snapshot proxy (cửa sổ bàn giao 90s, mục 6.1) + cờ ipv6
  createdAt, lastOpenedAt
}
```

Migration: `store.migrate()` (`SCHEMA_VERSION`, hiện **8**) tự bù field mới cho profile tạo từ bản cũ → **data cũ vẫn chạy sau khi update app**.

`baseline` và `lastObservation` **không** nằm trong `UpdateProfileInput`: chúng chỉ đổi
được qua `acceptBaseline()` / `recordObservation()`. Một patch chung chung sẽ cho phép
bất kỳ chỗ nào âm thầm biến một lần đo thành baseline — đúng thứ mà việc tách này sinh
ra để chặn.

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

- **Mỗi lần mở**: đọc local `navigator/screen/WebGL` (`captureFingerprint`) ngay trong page hiện có, **không** điều hướng tới origin trung gian và **không** import FingerprintJS CDN. Kết quả ghi vào `lastObservation`.
- Nút **Diagnostics** chạy probe local cho `canvas`, `audio` và font availability, lưu hash/summary vào `diagnostics` để đối chiếu giữa các profile mà không cần mạng.
- Nút **Test FP** mở trang kiểm tra (browserleaks…) ngay trong profile khi người dùng chủ động muốn kiểm tra bằng dịch vụ bên ngoài.
- **Đổi seed** xoá baseline + observation + visitorId, đo lại ở lần mở kế.

### 5.1 Ba khái niệm khác nhau, ba trường khác nhau

| Trường | Là gì | Ai ghi |
|---|---|---|
| `baseline` | fingerprint profile **phải** có | lần mở đầu (tự động, vì chưa có gì để ghi đè) · khoá identity · người dùng bấm chấp nhận |
| `lastObservation` | fingerprint browser **thực sự** báo ở lần mở gần nhất | mọi lần mở |
| `diagnostics` | lần chạy probe nặng **đầy đủ** gần nhất | chỉ khi bấm nút Diagnostics |

Trước đây cả ba dồn vào một trường `fingerprint` được ghi đúng **một lần** rồi thôi. Hệ
quả không phải là "cảnh báo yếu" mà là **không thể có cảnh báo**: cái browser báo về
chính là bản ghi của cái nó lẽ ra phải báo, nên một thay đổi không có gì để mâu thuẫn.

Ba đồng hồ này lệch nhau là chuyện bình thường — diagnostics thường cũ hơn cả hai cái
kia — nên UI hiện **cả ba mốc thời gian** cạnh nhau, thay vì một mốc khiến người đọc
tưởng hai cái còn lại cũng mới bằng.

### 5.2 Sức khoẻ profile (`profile-health.ts`)

`profileHealth(profile)` so `baseline` với `lastObservation` và trả về **đúng bốn**
trạng thái. Không có điểm số an toàn: một con số bịa ra sẽ mời người dùng hành động
theo độ chính xác mà dữ liệu không có.

| Trạng thái | Nghĩa |
|---|---|
| `stable` | mọi trường được so đều khớp |
| `changed` | có trường lệch — kèm danh sách `trường / baseline / đo được` |
| `insufficient` | chưa có gì để so (profile mới, hoặc profile cũ có từ trước khi app lưu baseline) |
| `check-failed` | có một lần đọc **đã thất bại và được ghi lại** (`lastObservationError`), mới hơn lần đọc thành công gần nhất |

Ba điểm cố ý **không** kết luận:

- Profile không có baseline là `insufficient`, **không phải** "lỗi". Một profile cũ chưa
  làm gì sai cả.
- `capturedAt` bị loại khỏi phép so — nó khác nhau ở mọi lần mở theo định nghĩa, để vào
  thì profile nào cũng "đổi" vĩnh viễn.
- **Đổi engine được báo là đổi engine**, không phải bằng chứng bị can thiệp. Đó là lý do
  thông thường nhất khiến fingerprint dịch chuyển, nên nó hiện cạnh danh sách trường
  lệch chứ không trộn vào đó.
- Đo hỏng (`check-failed`) không bao giờ hiển thị như "không có gì đổi". Một phép đo
  không xảy ra không phải bằng chứng rằng mọi thứ y nguyên.
- **`check-failed` được GHI LẠI, không suy ra.** "Không có observation" có hai nguyên
  nhân rất khác nhau — app chưa từng nhìn, hoặc app đã nhìn và không thấy gì — và chỉ từ
  sự vắng mặt thì không phân biệt được. Phiên bản đầu suy ra kiểu đó và **đã cho ra câu
  trả lời sai trên dữ liệu thật**: profile duy nhất của người dùng (store còn ở schema
  v2) bị báo `check-failed` trong khi không có phép kiểm tra nào từng chạy. Nay
  `recordObservationFailure()` ghi lại thất bại, và một lần đọc thành công sẽ xoá nó.

Chấp nhận thay đổi là **thao tác của người dùng** (`acceptCurrentFingerprint`), và nó
đòi phải có một lần đo để chấp nhận — ghi baseline cũ đè lên chính nó rồi báo thành
công còn tệ hơn là từ chối.

## 6. Identity lock & drift detection (`IdentityService`)

Vấn đề: proxy đổi IP, cập nhật binary, hay sửa cấu hình giữa chừng làm danh tính "trôi" → nền tảng nghi ngờ. Cơ chế:

- **Lock:** sau lần mở đầu thành công (có proxy + fingerprint), chốt `resolvedIdentity` = { seed, platform, proxy, exitIp, cloakBrowserVersion, timezone, locale, fingerprint, visitorId }.
- **Preflight (mở lần sau):** so sánh hiện tại với bản khoá: seed, platform, proxy, timezone, locale, version, và **exit IP** (đo lại qua proxy; snapshot cũ chỉ dùng lại trong **90 giây**, xem §6.1). Lệch → ném `IdentityDriftError`, **chặn mở**.
- **Dung sai IP:** `sameIpScope()` coi cùng `/24` là cùng danh tính (proxy residential sticky hay đổi octet cuối) → tránh báo nhầm.
- **forceLaunch ("Mở & cập nhật IP"):** re-align bản khoá theo **IP hiện tại**, **giữ** seed/fingerprint/cookie **và giữ nguyên phiên bản engine đã khoá** — lựa chọn an toàn thay vì reset hẳn.
- **"Chấp nhận engine mới" là thao tác RIÊNG** (`forceLaunch(id, { acceptEngine: true })` hoặc `acceptEngineVersion(id)` nếu không muốn mở browser). Ghi lại `engineAcceptedAt`.

> **Sửa 2026-09-09:** trước đây `reconcilePatch()` luôn gắn `cloakBrowserVersion` hiện tại, nên **một cú nhấn "Mở & cập nhật IP" âm thầm chấp nhận luôn engine mới**. Hai quyết định này có mức rủi ro khác nhau — nâng engine làm đổi fingerprint mà site nhìn thấy, xoay IP thì không — nên nay chúng tách hẳn, và hộp thoại drift nêu rõ engine đang khoá ở bản nào so với bản đang chạy.

### 6.1 Preflight phải chạy trước `launchPersistentContext` — không phải sau

`buildLaunchArgs` truyền `--restore-last-session`, nên **Chromium tự mở lại tab của
phiên trước** ngay khi tiến trình khởi động. Đây không phải suy luận: probe
`scripts/verify-windows/session-restore-probe.ts` đo được request của tab khôi phục đến
đích **sớm hơn 49 ms so với lúc `launchPersistentContext` trả về**. Khi dòng lệnh kế
tiếp trong app bắt đầu chạy thì website đã nhận request rồi.

Vì vậy toàn bộ cổng chặn nằm trong `BrowserManager.preflight()`, chạy trước khi gọi
launcher:

0. **Cổng engine — chạy cho MỌI lần mở, kể cả `force`.** Hỏi binary `--version`
   (§6.2). Vấn đề dứt khoát (`not-installed`, `version-mismatch`,
   `pin-unsatisfied`) → `EngineMismatchError`. Với profile đã khoá, engine đang
   chạy khác bản đã khoá → `IdentityDriftError`, **kể cả khi `force`**.
1. Profile **đã khoá** → so sánh identity (như §6). Lệch → `IdentityDriftError`.
2. Profile **có proxy** → xác minh proxy ra được exit IP. Snapshot chỉ được dùng lại
   nếu **thành công, có exit IP, và mới dưới 90 giây**; snapshot thất bại không bao giờ
   được tin.
3. Profile **có phiên cũ** (`lastOpenedAt !== null`) mà bước 2 không cho ra exit IP →
   `ProxyPreflightError`, **không gọi launcher**.

Ba điểm dễ hiểu nhầm:

- **Lần mở đầu tiên vẫn cho qua** dù proxy hỏng. Cookie jar rỗng thì không có gì để
  replay; proxy hỏng chỉ tốn của người dùng một trang lỗi, không tạo liên kết.
- **`forceLaunch` cũng chịu cổng này.** "Chấp nhận drift" nghĩa là bỏ qua *so sánh
  identity*, không phải bỏ qua *xác minh exit* — và cũng **không** phải bỏ qua engine.

> **Sửa 2026-09-11 (review):** trước đó `force: true` bỏ qua **toàn bộ**
> `checkLockedIdentity`, gồm cả engine. Giữ số version cũ trong store **không** giữ
> được binary cũ trên đĩa: profile khoá ở 146, máy đã đổi sang bản khác, bấm
> "Mở & cập nhật IP" thì profile vẫn mở bằng **bản mới** trong khi bản ghi và toast
> đều nói engine không đổi. Nay engine được so ở bước 0 cho mọi lần mở; muốn đổi thì
> phải chọn "Chấp nhận engine mới" — thao tác đó ghi lại version **trước** khi
> preflight chạy, nên một engine đã được chấp nhận sẽ khớp khi tới cổng.
- **Không có "mở bằng mọi giá".** Tab tự replay lúc khởi động, nên không có thời điểm
  nào để người dùng chen vào giữa. Muốn mở thì sửa proxy hoặc gỡ proxy khỏi profile.

Mức bảo đảm — nói đúng, không nói quá: app **không có** gateway/firewall, nên không
tuyên bố "không byte nào ra mạng trước khi kiểm tra". Điều bảo đảm được hẹp hơn:
**preflight hỏng thì `launchPersistentContext` không được gọi, nên không tồn tại tiến
trình Chromium nào để khôi phục phiên.**

> **Sửa 2026-09-10:** trước đây proxy của profile **chưa khoá** chỉ được test *sau* khi
> launch (để quyết định có khoá hay không), và TTL snapshot là **10 phút** — đủ dài để
> một proxy dân cư xoay IP vài lần bên trong cửa sổ đó. Cả hai đều là cổng chặn trên
> giấy: cái thứ nhất chạy sau khi tab đã replay, cái thứ hai duyệt bằng dữ liệu cũ.

### 6.2 Xác minh engine (`engine-info.ts`)

Identity đã khoá ghi `cloakBrowserVersion` theo `binaryInfo().version`. Nhưng con số đó
là **marker của package** — tên một thư mục và một URL tải — chứ không phải bằng chứng
về thứ nằm trong thư mục đó. Đặt `CLOAKBROWSER_BINARY_PATH` trỏ vào build khác thì bản
ghi thành hư cấu mà không ai nhận ra.

Lúc khởi động, `readEngineInfo()` hỏi thẳng binary (`--version`) và so:

| Trường | Là gì |
|---|---|
| `markerVersion` | package giải theo nền tảng, vd `145.0.7632.109.2` |
| `binaryVersion` | binary tự khai, vd `145.0.7632.109` |
| `bundledVersion` | "mới nhất trên **mọi** nền tảng" — trên darwin là bản **không có build macOS**; không bao giờ được coi là engine đang dùng |

Marker = version Chromium (4 số) + số hiệu patch của CloakBrowser, còn binary chỉ khai
phần Chromium — nên chỉ so được trên tiền tố đó (`chromiumPartOf`).

Bốn tình huống được **báo**, không tình huống nào bị **tự sửa**:

| `kind` | Khi nào |
|---|---|
| `not-installed` | không có binary ở đường dẫn package trỏ tới |
| `unreadable` | có file nhưng không trả lời `--version` — chưa xác minh được, và **không** mặc định là khớp |
| `version-mismatch` | package khai một đằng, binary khai một nẻo |
| `pin-unsatisfied` | đặt `CLOAKBROWSER_VERSION` nhưng đang chạy bản khác |

Kết quả **được nối vào quyết định mở**, không chỉ hiện banner:

- `not-installed` · `version-mismatch` · `pin-unsatisfied` → `EngineMismatchError`,
  **chặn trước khi Chromium tồn tại** (nên trước cả session restore).
- `unreadable` → **không** chặn mở: một binary không trả lời `--version` vẫn có thể là
  bản đúng, chặn mọi lần mở vì một lỗi exec là đánh đổi tệ hơn. Nhưng nó **chặn việc
  khoá identity mới** — không thể lấy một engine không gọi được tên làm baseline.
- So sánh identity dùng **bản binary tự khai**, không dùng marker. Đây chính là chỗ mà
  một `CLOAKBROWSER_BINARY_PATH` trỏ sang build khác từng vô hình.
- Profile đã khoá được **pin** khi launch (`browserVersion` = marker vừa xác minh), nên
  launcher không thể tự giải ra một build khác bản vừa kiểm.

Đo 2026-09-11: pin bằng marker đang cài launch bình thường (Chrome/145.0.0.0, cùng
binary với lúc không pin); pin vào một bản không tồn tại thì **báo lỗi rõ** (`HTTP 404`)
chứ **không** âm thầm lùi về bản khác. Vì cổng engine chạy trước, launcher không bao giờ
gặp một pin không thoả được.

Pin lấy từ **marker vừa xác minh**, không lấy từ `resolvedIdentity.cloakBrowserVersion`:
hai marker có thể trùng version Chromium nhưng khác số hiệu patch của CloakBrowser, và
pin vào một patch chưa cài sẽ làm launcher đi tải.

App không tự tải, không tự nâng, không tự hạ engine.

Đo trên máy này 2026-09-11: marker `145.0.7632.109.2` · binary `145.0.7632.109` · tier
`free` · `verified: true` · `problems: []`. Một identity khoá ở `145.0.7632.109.2` khớp;
khoá ở `146.0.7680.177.5` **không** khớp và bị chặn.

> Trên darwin chỉ tồn tại **một** build công khai (findings §8d), nên pin version ở đây
> không phải cần gạt thật. `CLOAKBROWSER_VERSION` được tôn trọng và báo khi không thoả,
> nhưng UI không dựng gì xoay quanh một khả năng không có thật. Giữ binary cũ vô hạn
> cũng **không** phải chiến lược bảo mật — nó chỉ là tình trạng hiện tại của nguồn tải.

## 7. Cảnh báo unlinkability (`unlinkability.ts`)

Mức độ nói về **điều quan sát được chứng minh**, không nói về việc nó nghe đáng sợ đến đâu:

- `level: high` — **liên kết đã quan sát được**, hoặc mất cô lập đã quan sát được:
  profile **không proxy** (dùng IP máy chủ) · exit IP đã khoá bị đổi · trùng exit IP với
  profile khác · `ipv6-shared` (xem dưới).
- `level: medium` — **cấu hình chắc chắn sẽ tạo liên kết nếu để nguyên**: trùng host
  proxy với profile khác.
- `level: low` — **thông tin đáng biết nhưng tự nó không phải bằng chứng liên kết**:
  `ipv6-present` · `same-asn-geo`. Badge hiển thị xám, **không** có dấu ⚠.

> **Sửa 2026-09-10 — hai cảnh báo cũ vượt quá bằng chứng có được:**
>
> **IPv6.** Phép đo `probeIpv6()` chạy *bên trong browser đã đi qua proxy*, nên một proxy
> có cover IPv6 sẽ trả về địa chỉ IPv6 **của chính nó**. Từ một profile thì không phân
> biệt được IPv6 của proxy với IPv6 của máy chủ — nhưng cảnh báo cũ vẫn khẳng định "IPv6
> đang lộ ra ngoài". Nay tách đôi: `ipv6-present` (`low`, nêu đúng là chưa kết luận
> được) và `ipv6-shared` (`high`, **chỉ** khi cùng một IPv6 xuất hiện dưới **hai proxy
> khác nhau** — địa chỉ đó không thể đến từ proxy nào cả). Hai profile dùng *chung một*
> proxy mà thấy chung IPv6 thì **không** bị flag: đó chính là địa chỉ của proxy.
>
> **`same-asn-geo`.** Hai profile IP khác nhau nhưng cùng ASN/ISP/thành phố chính là
> hình dạng của một ISP bình thường — hàng triệu người dùng thật không liên quan gì nhau
> đều khớp mô tả đó. Nay là `low` và câu chữ nói thẳng đây không phải bằng chứng liên
> kết.

Hiển thị badge cảnh báo trên từng card.

## 8. Đóng gói & cập nhật

- `electron-builder`: `.dmg` (arm64 + x64), `.exe` (NSIS x64). `appId` cố định `com.cloakbrowser.manager` → userData ổn định qua các bản → **giữ data**.
- **CI (GitHub Actions):** build trên runner macOS + Windows **thật**, gộp artifact, publish 1 release theo tag. ⚠️ Build `.exe` NSIS từ macOS (Wine) tạo installer hỏng ("integrity check failed") → bắt buộc build trên Windows runner.
- **Update:** `updater.checkForUpdate()` so version app với GitHub Release mới nhất (repo public, không cần token); có bản cao hơn → banner. Không auto-install (cần code-sign/notarize).

## 9. Hạn chế (đầy đủ, đã kiểm chứng)

### 9.1 macOS — canvas *export* & audio không đa dạng hoá theo seed ⚠️ (quan trọng nhất)

> **Cập nhật 2026-09-09 — đo lại trên máy thật, sửa nguyên nhân gốc ghi ở bản trước.**
> Số liệu đầy đủ: [`macos-isolation/findings.md`](macos-isolation/findings.md).
> 3 nhóm × 3 profile × 5 lần mở × 3 lần đo = 132 quan sát.

**Canvas có HAI đường đọc và binary Mac chỉ nhiễu MỘT đường:**

| Đường đọc | Khác theo seed? |
|---|---|
| `toDataURL()` (png/jpeg/webp), `toBlob()` | ❌ **giống hệt mọi seed** |
| `getImageData()` | ✅ khác theo seed |
| `measureText().width` | ✅ khác theo seed |

Nguyên nhân **không phải** "bản Mac thiếu patch canvas" như tài liệu cũ viết. Patch có
tồn tại và chạy — trích chuỗi từ binary thấy `fingerprinting-canvas-image-data-noise`,
`fingerprinting-canvas-measuretext-noise`, `fingerprinting-client-rects-noise` — nhưng
**không phủ đường encode/export**. Mà `toDataURL()` mới đúng là đường FingerprintJS,
browserleaks và CreepJS dùng.

**Ba trục thực sự liên kết các profile trên một máy Mac** (đo ở persona macOS, cấu hình
app, và giống hệt khi chạy engine defaults):

1. `canvas.text.export` — trùng cả 3 profile
2. `canvas.geometry.export` — trùng cả 3 profile
3. `audio` — trùng cả 3 profile

**Cẩn thận với các trục "trông như đã khác nhau":** `font.availability`, `font.metrics`
và `clientRects` cho digest khác nhau giữa các profile, nhưng đó là **hệ quả của nhiễu
theo seed**, không phải máy khác nhau. Đo tập font thật: **54/57 họ font (95%) được cả
3 profile phát hiện**, chỉ 3 họ sát ngưỡng (`Baskerville`, `Didot`, `Gill Sans`) bị lật.
Tập font vẫn là tập của một máy.

**Không có flag nào sửa được:** binary Mac 145 không chứa `--fingerprint-noise`,
`--fingerprint-webrtc-ip`, `--fingerprint-locale`, `--fingerprint-storage-quota`. Và
**không tồn tại build macOS free nào mới hơn** `145.0.7632.109.2` (04/03/2026) — mọi
asset `darwin-arm64` từ 146 trở lên đều trả 404.

**Ổn định identity:** tốt. Qua 5 lần mở lại × 3 lần đo, **không trường nào drift**,
không trường nào nhiễu trong phiên.

**Khuyến nghị giữ nguyên: chạy account giá trị cao trên Windows.** macOS dùng cho
dev/test hoặc rủi ro thấp — nhưng lý do nay chính xác hơn: không phải "thiếu patch"
mà là "patch không phủ đường export".

**Chưa trả lời được:** canvas export hash đó là *riêng máy này* hay *chung cho mọi
Apple Silicon chạy CloakBrowser 145*? Dữ liệu một máy không phân biệt được — cần một
Mac thứ hai. Đây là khác biệt giữa "rủi ro cao" và "entropy thấp".

### 9.1b Persona: máy Mac nên khai macOS, không nên giả lập Windows

Đo trực tiếp (nhóm A vs nhóm B, cùng seed, cùng máy): giả lập Windows trên host Mac
**không giảm được liên kết** (vẫn trùng đúng 3 trục HIGH đó, cộng thêm
`font.availability`) mà **thêm 2 mâu thuẫn kiểm chứng được trên cả 3 profile**:

1. Renderer khai `ANGLE (NVIDIA … Direct3D11)` nhưng driver phơi ra extension GPU Apple
   (`pvrtc`, `astc`, `etc`) — máy Windows D3D11 không bao giờ có.
2. Không một họ font Windows nào tồn tại, trong khi 10 họ font chỉ-có-trên-Mac đều có.

→ Từ 2026-09-09, **profile mới trên host macOS mặc định persona `macos`**
(`defaultPlatformFor` trong `store.ts`). Profile cũ **giữ nguyên** persona đã lưu —
`platform` nằm trong `LOCKED_IDENTITY_FIELDS` và `migrate()` không đụng tới.

### 9.1c WebRTC trên macOS — flag chết, không phải leak

`--fingerprint-webrtc-ip` **không tồn tại** trong binary Mac. Nhưng đo thực tế cho thấy
binary **không phát ICE candidate nào cả** (0 candidate, gathering `complete`), trong
khi Chrome thật phát đúng 1 candidate mDNS. Nên:

- ✅ Không có leak IP thật qua host candidate.
- ⚠️ Flag app đang truyền là **flag chết** trên macOS — tài liệu/UI không được tuyên bố
  là đang chống WebRTC leak trên nền tảng này.
- ⚠️ 0 candidate là **khác Chrome thật** → một dị thường nhận diện được (chung cho mọi
  người dùng CloakBrowser, không phải tín hiệu liên kết giữa các profile).
- ⛔ Mới phủ đường host candidate. Đường srflx (qua STUN, khi có proxy) **chưa đo**.

### 9.1d Hành vi cửa sổ trên macOS — đã đo trên máy thật

`scripts/verify-windows/display-probe.ts`, chạy 2026-09-11 trên MacBook Retina (màn
logic 1800×1169, DPR 2). Kiểm hai tuyên bố mà `launch-args.ts` dựa vào:

| Kiểm | Kết quả |
|---|---|
| `screen` == màn hình thật | 1800×1169 ✓ |
| `avail` nằm trong `screen` | 1800×1074 ✓ (chừa menu bar + dock) |
| `inner ≤ outer ≤ screen` | 1800 ≤ 1800 ≤ 1800 ✓ |
| Cửa sổ nằm trong màn hình | (0,39) 1800×1130 ✓ |
| DPR phản ánh Retina | 2 ✓ |
| **Mở tab mới không xê dịch cửa sổ** | geometry y hệt trước/sau ✓ |
| `screen`/DPR không đổi khi mở tab | ✓ |
| `screen` không đổi khi fullscreen | ✓ |
| Cửa sổ trở lại kích thước cũ sau fullscreen | ✓ |
| `screen`/DPR/`colorDepth` giống hệt qua một lần đóng–mở lại | ✓ |

**Một quan sát cần nói cho đúng.** Khi gọi `requestFullscreen()`,
`document.fullscreenElement` được set nhưng **viewport không đổi** — cả số JS báo lẫn
kích thước ảnh render thật (đọc từ header PNG của screenshot) đều đứng yên.

Đây **không phải** hành vi của CloakBrowser. Chạy đúng chuỗi đó trên **Google Chrome
nguyên bản** trong cùng điều kiện Playwright headed: cũng y như vậy
(`inner 987 → 987`, render `1974 → 1974`). Một Chromium headed bị lái qua CDP không
nhận chuyển cảnh fullscreen của macOS. Probe nay tự chạy control này và chỉ báo FAIL khi
CloakBrowser **khác** Chrome nguyên bản.

Giới hạn phải ghi rõ: chuỗi trên chạy dưới automation. **Fullscreen do người dùng tự
bấm chưa được kiểm** — cần điều khiển ở tầng OS, chưa làm. Resize/maximize bằng tay cũng
vậy; thứ đo được là geometry sau `--start-maximized`, sau khi mở tab, và sau khi mở lại.

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
- **IPv6:** thấy IPv6 reachable qua browser proxied → báo `ipv6-present` mức `low`, **không** khẳng định là leak (địa chỉ đó có thể là của chính proxy). Chỉ khẳng định leak khi cùng một IPv6 xuất hiện dưới hai proxy khác nhau (`ipv6-shared`, `high`) — xem mục 7.
- **DNS true leak-test:** **ngoài phạm vi** — cần hạ tầng callback/API ngoài (proxycheck/bash.ws) log resolver IP. Không làm offline; để sau nếu cắm API.

## 10. Kiểm thử
Unit (Vitest): `launch-args`, `unlinkability`, `store` (+migrate/regenerate), `fingerprint-probe`, `browser-manager`, `proxy-tester`, `proxy-parse`, `identity-service`, `quarantine`. Integration (`tests/integration`, loại khỏi run mặc định): mở 2 profile seed khác nhau → assert fingerprint khác + `webdriver=false`.

## 11. Bảo mật & vận hành
- Renderer cô lập, không truy cập Node trực tiếp; mọi thao tác qua IPC có kiểm soát.
- Quá trình mở: clear quarantine binary (macOS), startup state machine chặn UI cho tới khi service sẵn sàng.
- Khuyến nghị vận hành: 1 proxy residential / profile, không đăng nhập chéo, payout/email/nội dung tách biệt từng account.
