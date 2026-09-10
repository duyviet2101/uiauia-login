# Kết quả kiểm chứng macOS — 2026-09-09

Chạy trên máy thật của người dùng. Mọi số liệu dưới đây đến từ profile thử vứt đi
trong thư mục tạm; **không profile thật nào được mở hay sửa**.

## 1. Điều kiện thử

| Hạng mục | Giá trị |
|---|---|
| Host | macOS 26.5 (build 25F71), Mac15,6 — Apple M3 Pro, 11 nhân, 18 GB, arm64 |
| Màn hình dùng cho `--fingerprint-screen-*` | 1920x1080 |
| Binary (marker cache) | `145.0.7632.109.2`, tier **free** |
| Binary (`--version` thực chạy) | `Chromium 145.0.7632.109` |
| npm `cloakbrowser` | `0.5.10` |
| Ma trận | 3 nhóm × 3 profile × 5 lần mở × 3 lần đo = **132 quan sát hợp lệ** |
| Seed cố định dùng chung 3 nhóm | `11111`, `66666`, `4242042` |
| Proxy | không có → mọi kết luận liên quan proxy đều `pending` |

Nhóm: **A** = persona macOS + cấu hình app · **B** = persona Windows + cấu hình app
(tái kiểm chứng kết luận cũ) · **C** = persona macOS + engine defaults, seed được pin
(đối chứng để tách ảnh hưởng của cấu hình app).

Artifact: `scripts/verify-windows/reports/2026-09-09T09-5{5,8}-*-{A,B,C}/`

## 2. Phát hiện lớn nhất: canvas có HAI đường đọc, chỉ một đường được nhiễu

Đây là điều báo cáo cũ không thể thấy vì nó chỉ băm `toDataURL()`.

Thí nghiệm riêng, 3 seed, lặp lại được (`canvas-probe`, đã chạy 2026-09-09):

| Đường đọc canvas | Khác nhau theo seed? |
|---|---|
| `toDataURL()` PNG | ❌ **giống hệt** (`1d777ea2cbef751d` cho cả 3 seed) |
| `toDataURL('image/jpeg')` | ❌ giống hệt |
| `toDataURL('image/webp')` | ❌ giống hệt |
| `toBlob()` PNG | ❌ giống hệt |
| `getImageData()` | ✅ khác theo seed |
| `measureText().width` | ✅ khác theo seed (550.5199 / 550.5195 / 550.5225) |

Kết quả không phụ thuộc thứ tự gọi, và ổn định khi đọc lại nhiều lần trong cùng phiên.

**Giải thích:** binary Mac 145 có nhiễu canvas theo seed, nhưng chỉ trên đường
`getImageData` và `measureText`. Khớp đúng ba chuỗi trích được từ binary:
`fingerprinting-canvas-image-data-noise`, `fingerprinting-canvas-measuretext-noise`,
`fingerprinting-client-rects-noise`. Đường **encode/export thì không được nhiễu**.

**Vì sao điều này quan trọng:** FingerprintJS, browserleaks, CreepJS đều lấy canvas
fingerprint qua `toDataURL()`. Nghĩa là đúng cái đường mà kẻ nhận diện thật sự dùng
lại là đường **giống hệt nhau giữa mọi profile trên máy này**.

> Đính chính ghi chú cũ: kết luận "canvas trùng trên macOS" **đúng** với đường export,
> nhưng lý do "binary Mac không có patch canvas" thì **sai** — patch có tồn tại và
> hoạt động, chỉ là không phủ đường export.

## 3. Fingerprint nào THỰC SỰ trùng trên native Mac

Nhóm A (persona macOS, cấu hình app), 3 profile × 5 lần mở × 3 lần đo:

| Trường | Distinct | Trùng | Trong phiên | Qua 5 lần mở |
|---|---|---|---|---|
| **canvas.text.export** | 1/3 | **cả 3 profile** | ổn định | ổn định |
| **canvas.geometry.export** | 1/3 | **cả 3 profile** | ổn định | ổn định |
| **audio** | 1/3 | **cả 3 profile** | ổn định | ổn định |
| canvas.text.imagedata | 3/3 | – | ổn định | ổn định |
| canvas.geometry.imagedata | 3/3 | – | ổn định | ổn định |
| font.metrics | 3/3 | – | ổn định | ổn định |
| font.availability | 3/3 | – | ổn định | ổn định |
| clientRects | 3/3 | – | ổn định | ổn định |
| webgl.renderer | 3/3 | – | ổn định | ổn định |

CONTEXT (trùng nhưng hợp lý trên máy thật): `screen`, `ua`, `timezone`,
`webgl.vendor` = `Google Inc. (Apple)`.

**Chỉ có 3 trục HIGH thực sự liên kết: canvas export (2 workload) và audio.**

### 3.1 "Font khác nhau" là ảo — phải đọc kỹ

`font.availability` báo 3/3 distinct, nhưng đó **không** phải bằng chứng font đa dạng:

- verify-A1: 57 họ · verify-A2: 55 · verify-A3: 56
- **54/57 họ (95%) được cả 3 profile phát hiện**
- Chỉ 3 họ lệch: `Baskerville`, `Didot`, `Gill Sans`

Ba họ này nằm sát ngưỡng so sánh bề rộng, bị lật do nhiễu `measureText` theo seed.
Tập font thật vẫn là **một tập duy nhất của một máy**. Một detector đo chắc tay
(nhiều mẫu, ngưỡng rộng) vẫn thấy chung một tập font.

→ Đây đúng là cái bẫy "hash khác ≠ không liên kết được". Harness đã được bổ sung
phép đo overlap để không lặp lại lỗi này.

Cùng lý do, `font.metrics` và `clientRects` khác nhau **vì nhiễu theo seed**, không
phải vì máy khác nhau. Chúng vẫn có giá trị (phá được font/rect fingerprint ngây thơ)
nhưng không được diễn giải là "3 thiết bị khác nhau".

## 4. Fingerprint nào không ổn định qua restart

**Không có.** Qua 5 lần mở lại × 3 lần đo mỗi lần, **mọi trường ở cả ba nhóm đều
ổn định tuyệt đối** — không trường nào drift, không trường nào nhiễu trong phiên.
Identity của một profile giữ nguyên qua các lần mở.

Một lần đo hỏng duy nhất (`verify-A1` lần mở 1: "Target page, context or browser has
been closed") — lỗi đo, đã được ghi riêng và **không** bị tính thành collision.

## 5. Persona Windows trên máy Mac là lựa chọn tệ hơn — đã đo

Nhóm B so với nhóm A, cùng seed, cùng máy:

| | A (persona macOS) | B (persona Windows) |
|---|---|---|
| Trường HIGH bị trùng cả 3 profile | 3 | **4** (thêm `font.availability`) |
| Consistency | 3/3 profile sạch | **3/3 profile FAIL** |

Hai mâu thuẫn cứng ở nhóm B, xuất hiện trên **cả ba** profile:

1. **`render-stack-coherence` FAIL** — chuỗi renderer khai
   `ANGLE (NVIDIA GeForce RTX 3050 … Direct3D11)` nhưng driver lại phơi ra
   `webgl_compressed_texture_pvrtc`, `astc`, `etc` — đây là extension của GPU Apple.
   Máy Windows dùng D3D11 không bao giờ có PVRTC/ASTC. Detector đọc cả hai thấy ngay.
2. **`font-stack-coherence` FAIL** — không có một họ font Windows nào, trong khi
   10 họ font chỉ có trên Mac đều hiện diện (`Apple Chancery`, `Chalkduster`,
   `Geneva`, `Helvetica Neue`, `Lucida Grande`, `Menlo`, `Monaco`, `Papyrus`,
   `Skia`, `Zapfino`).

Nhóm A: cả hai rule PASS.

→ Giả lập Windows từ máy Mac **không giảm được liên kết** (vẫn trùng đúng 3 trục HIGH
đó) mà **thêm 2 lời nói dối kiểm chứng được** và **thêm 1 trục trùng**.

## 6. Cấu hình app KHÔNG phải nguyên nhân

Nhóm C (engine defaults, chỉ pin seed) trùng đúng cùng 3 trục HIGH như nhóm A.

→ Theo cây quyết định của kế hoạch: **A và C đều có vấn đề ⇒ giới hạn nằm ở engine/
binary, không phải ở override của app.** Không cần chạy ablation từng nhóm flag cho
câu hỏi canvas/audio (G3.5 vì thế không cần thiết cho vấn đề này).

## 7. WebRTC — giả thuyết ban đầu bị bác bỏ

Giả thuyết trước khi đo: binary Mac thiếu switch `fingerprint-webrtc-ip` (đã xác nhận
bằng `strings`) ⇒ có thể đang lộ IP thật.

Đo thực tế:

| Trình duyệt / cấu hình | ICE candidate thu được |
|---|---|
| **Chrome thật** (control) | 1 candidate host, địa chỉ mDNS `<uuid>.local` |
| CloakBrowser — engine defaults | **0** |
| CloakBrowser — cấu hình app (macOS) | **0** |
| CloakBrowser — + `--fingerprint-webrtc-ip=203.0.113.7` | **0** |
| CloakBrowser — persona windows + flag | **0** |

Gathering đều báo `complete`, không phải timeout.

**Kết luận:**
- ✅ **Không có leak IP qua host candidate** — binary không phát candidate nào cả.
  Giả thuyết ban đầu **bị bác bỏ**.
- ⚠️ **`--fingerprint-webrtc-ip` là flag chết trên Mac** — không có candidate nào để
  ghi đè, và switch không tồn tại trong binary. App vẫn đang truyền nó cho mọi profile
  đã khoá. Vô hại nhưng **tài liệu/UI không được tuyên bố là đang chống WebRTC leak
  trên macOS**.
- ⚠️ **Đây lại là một dị thường nhận diện được**: Chrome thật luôn phát đúng 1
  candidate mDNS; phát 0 candidate là khác biệt so với Chrome thật. Dị thường này
  **chung cho mọi người dùng CloakBrowser**, nên nó là vấn đề *bị phát hiện*, không
  phải vấn đề *bị liên kết*.
- ⛔ **`pending`**: chỉ mới phủ đường host candidate. Đường srflx (qua STUN, khi có
  proxy) **chưa đo được** vì không có proxy. Không được tuyên bố "không leak" cho
  phiên có proxy.

## 8. Nguyên nhân đã xác định vs còn chưa rõ

**Đã xác định:**
- Canvas export không đa dạng theo seed ⇒ nguồn liên kết #1. Nguyên nhân: patch nhiễu
  của binary không phủ đường encode. Không có flag nào mở được (`fingerprint-noise`
  không tồn tại trong binary Mac).
- Audio không đa dạng theo seed ⇒ nguồn liên kết #2. Cùng bản chất.
- Tập font dùng chung ⇒ nguồn liên kết #3 (bị che sau nhiễu measureText).
- Mâu thuẫn của persona Windows trên host Mac: do WebGL extension và font stack đến từ
  máy thật, trong khi chuỗi renderer/UA bị giả lập.

**Chưa rõ / chưa đo được:**
- Canvas export hash `1d777ea2cbef751d` là **riêng của máy này** hay **chung cho mọi
  Apple Silicon chạy CloakBrowser 145**? Không phân biệt được bằng dữ liệu một máy.
  Đây là khác biệt giữa "rủi ro cao" và "entropy thấp, rủi ro thấp". → cần một máy Mac
  thứ hai. **pending**.
- Ba chuỗi `fingerprinting-*-noise` có bật/tắt được qua `--enable-features` không —
  chưa thử.
- Hành vi qua proxy thật (exit IP, srflx, timezone) — **pending**.

## 8b. Session restore chạy TRƯỚC khi app kịp làm gì — đã đo

Kế hoạch §15 dựa trên một tuyên bố: `--restore-last-session` do Chromium tự thực thi,
app không chen được vào giữa. Tuyên bố đó **đã được đo**, không suy luận.

Script: `scripts/verify-windows/session-restore-probe.ts`. Một HTTP server ở
`127.0.0.1` đóng vai "website"; profile tạm truy cập nó, đóng sạch, rồi mở lại bằng
đúng `buildLaunchArgs()` thật và **không** điều hướng gì thêm.

Kết quả (2026-09-10, binary 145.0.7632.109):

```
pass 2: launchPersistentContext resolved at +695ms
hit /session-page  at +646ms  (49ms BEFORE launchPersistentContext resolved)
hit /favicon.ico   at +708ms  (+13ms AFTER  launchPersistentContext resolved)
pages after reopen: ["http://127.0.0.1:.../session-page", "about:blank"]
```

**Request của tab được khôi phục đến đích sớm hơn 49 ms so với lúc
`launchPersistentContext` trả về.** Nói cách khác: khi dòng lệnh kế tiếp trong app bắt
đầu chạy, website đã nhận request rồi. Mọi kiểm tra đặt sau lời gọi launch không phải
là cổng chặn — nó là dòng log.

Hệ quả trực tiếp: cổng chặn **chỉ có thể** nằm trước `launchPersistentContext`
(phương án (a) của §15). Phương án (b) — bỏ flag và tự khôi phục tab bằng Playwright —
không cần dùng đến.

### Giới hạn phải nói rõ

Không có gateway/firewall nên **không** tuyên bố "không một byte nào ra mạng trước khi
kiểm tra đạt". Điều đã chứng minh được hẹp hơn và vẫn đủ dùng: **nếu preflight ném lỗi
thì `launchPersistentContext` không được gọi, nên không có tiến trình Chromium nào tồn
tại để khôi phục session.** Đó là toàn bộ mức bảo đảm.

---

## 8c. Hai cảnh báo cũ không đủ bằng chứng — đã sửa

Cả hai đều vi phạm chính nguyên tắc của kế hoạch ("hash khác ≠ chắc chắn không liên kết"
và ngược lại).

**`ipv6-leak`.** Cũ: thấy bất kỳ IPv6 nào trong `lastProxyCheck` là bắn cảnh báo "IPv6
đang lộ ra ngoài", mức medium. Nhưng `ProxyTester.probeIpv6()` chạy **bên trong browser
đã đi qua proxy** — một proxy SOCKS5/HTTP có cover IPv6 sẽ trả về địa chỉ IPv6 *của
chính nó*. Từ một profile không phân biệt được IPv6 của proxy với IPv6 của máy chủ.

Mới: `ipv6-present` mức `low` (thông tin, không phải rủi ro) + `ipv6-shared` mức `high`
khi **cùng một IPv6 xuất hiện dưới hai proxy khác nhau** — địa chỉ đó không thể đến từ
proxy nào cả, nên đó là liên kết chứng minh được. Hai profile dùng *chung một* proxy mà
thấy chung IPv6 thì **không** bị flag.

**`same-asn-geo`.** Cũ: hai profile khoá, IP khác nhau, cùng ASN/ISP/thành phố → cảnh báo
mức medium như một dấu hiệu liên kết. Nhưng đó chính là hình dạng của một ISP bình
thường: hàng triệu người dùng thật không liên quan gì đến nhau đều khớp mô tả đó. Nó
không phải bằng chứng hai profile là cùng một người.

Mới: hạ xuống mức `low`, và câu chữ nói thẳng đây không phải bằng chứng liên kết.

Thêm mức `low` vào `ProxyWarningLevel` để phân biệt *"điều đáng biết"* với *"rủi ro"*;
badge `low` hiển thị xám và không có dấu ⚠.

---

## 8d. Vẫn không có binary macOS nào mới hơn — kiểm lại 2026-09-10

Banner của wrapper khi launch có in: *"Running the free binary (v146). The latest binary
(v151) is free too, with 1 concurrent session."* Câu này mâu thuẫn với kết luận cũ
(148/150/151 là Pro), nên đã kiểm lại bằng GitHub Releases API + HEAD lên CDN:

| Bản | Tag GitHub | Asset `darwin-arm64` | CDN `darwin-arm64` | CDN `windows-x64` |
|---|---|---|---|---|
| 151.0.7922.108.4 | `-pro` | không có | 404 | 404 |
| 150.0.7871.114.6 | `-pro` | không có | 404 | 404 |
| 148.0.7778.215.5 | `-pro` | không có | 404 | 404 |
| 146.0.7680.177.5 | free | không có | 404 | **200** |
| 145.0.7632.109.2 | free | **có** | **200** | 200 |

Đọc đúng:

- `145.0.7632.109.2` vẫn là bản mới nhất **có asset macOS** ở cả hai nguồn công khai.
  Trên GitHub, mọi tag sau nó (kể cả các bản 145.0.7632.159.x) đều không có darwin.
- Các tag 148/150/151 gắn hậu tố `-pro` và **không** publish asset cho cả macOS lẫn
  Windows — tức là tải qua đường có license, không phải tải công khai.
- Banner nói v151 "free" nhưng kèm điều kiện phải có key (`cloakbrowser login`).
  **Chưa kiểm chứng được** một key miễn phí sẽ tải về gì, vì ràng buộc của nhiệm vụ cấm
  đăng nhập hoặc lấy key thay người dùng.

Điều nói được chắc: **không có bản macOS công khai nào mới hơn 145.0.7632.109.2.** Việc
key miễn phí có mở ra một build macOS 151 hay không là câu hỏi bỏ ngỏ, chỉ người dùng
tự đăng nhập mới trả lời được — và nếu có thì đó là đổi engine, tức là drift identity
cho mọi profile đang khoá (§16.1).

---

## 9. Thay đổi đã triển khai

| Thay đổi | Căn cứ | Trước → Sau |
|---|---|---|
| Profile **mới** trên host Mac mặc định persona `macos` (`defaultPlatformFor` trong `store.ts`, và mặc định trong `ProfileForm`) | §5 — nhóm B thua nhóm A ở cả liên kết lẫn consistency | Windows luôn luôn → theo host. **Profile cũ không đổi**: `platform` nằm trong `LOCKED_IDENTITY_FIELDS` và `migrate()` không đụng giá trị đã lưu |
| Harness đa persona (`--persona`, `--opens`, `--repeats`, `--seeds`, `--launch-mode`, `--group`, `--drop-arg`, `--extra-arg`) | G1 | Chỉ chạy được persona Windows → chạy được cả hai, có đối chứng và ablation |
| Digest đổi sang **SHA-256** | Hash 32-bit FNV không đủ để tuyên bố "giống hệt" | FNV-1a 32-bit → SHA-256 |
| Tách `canvas.*.export` khỏi `canvas.*.imagedata` | §2 | Chỉ đo 1 đường → đo cả hai, đường export mới là đường kẻ tấn công dùng |
| Thêm phép đo **font set overlap** | §3.1 | Chỉ so digest → so tập font thật |
| Thêm rule `render-stack-coherence` và `font-stack-coherence` | §5 | Không có → bắt được cả hai mâu thuẫn của persona chéo |
| Envelope `Measured<T>` (`ok`/`unsupported`/`error`) | Yêu cầu của kế hoạch | `null` dùng chung → ba trạng thái tách bạch, lỗi đo không bao giờ thành collision |
| Phân tích `stability` tách 3 câu hỏi | Yêu cầu của kế hoạch | Một phép so → nhiễu trong phiên / drift qua lần mở / trùng giữa profile |
| `reanalyze.ts` | Sửa cách phân tích mà không phải chạy lại máy | – |
| **Preflight dời lên trước `launchPersistentContext`** (`BrowserManager.preflight`) | §8b — request khôi phục đến sớm hơn launch 49 ms | Proxy của profile **chưa khoá** chỉ được test *sau* khi launch (để quyết định có khoá không) → test *trước*, và snapshot đó được tái dùng để khoá nên không test hai lần |
| Chặn mở profile **có phiên cũ** khi proxy không ra được exit IP (`ProxyPreflightError`) | §8b | Mở luôn, tab cũ tự replay qua exit chưa xác minh → chặn trước khi tiến trình Chromium tồn tại. Lần mở **đầu tiên** vẫn cho qua: cookie jar rỗng thì proxy hỏng chỉ tốn một trang lỗi, không tạo liên kết |
| `forceLaunch` cũng chịu cổng proxy | §8b | "Chấp nhận drift" vô tình bỏ qua luôn cả kiểm tra proxy → force chỉ bỏ qua *so sánh identity*, không bỏ qua *xác minh exit* |
| TTL snapshot proxy 10 phút → **90 giây** | Proxy dân cư xoay IP nhiều lần trong 10 phút | Cache thật sự (chấp nhận dữ liệu cũ) → cửa sổ bàn giao giữa precheck và launch trong cùng một thao tác |
| `ipv6-leak` → `ipv6-present` (low) + `ipv6-shared` (high) | §8c | Thấy IPv6 là báo rò rỉ → chỉ báo rò rỉ khi chứng minh được địa chỉ không đến từ proxy |
| `same-asn-geo` hạ xuống mức `low` | §8c | Trình bày như bằng chứng liên kết → trình bày như thông tin ngữ cảnh |
| **Tách `baseline` / `lastObservation` / `diagnostics`** (`SCHEMA_VERSION` 7→8) | Kế hoạch §16.3 | Một trường `fingerprint` ghi **đúng một lần** rồi thôi. Hệ quả không phải "cảnh báo yếu" mà là **không thể có cảnh báo**: cái browser báo về chính là bản ghi của cái nó lẽ ra phải báo |
| Đọc fingerprint ở **mọi** lần mở | như trên | Chỉ đọc khi profile chưa có fingerprint → sau lần mở đầu app không bao giờ nhìn lại |
| `acceptBaseline()` / `recordObservation()` thay cho `update({fingerprint})` | như trên | Bất kỳ chỗ nào cũng ghi đè được → hai mutation riêng, và `baseline`/`lastObservation` bị **loại khỏi** `UpdateProfileInput` |
| `profile-health.ts` — bốn trạng thái, không điểm số | Kế hoạch §17 | Không có gì → `stable` / `changed` / `insufficient` / `check-failed`, kèm bảng `trường / baseline / đo được` |
| Đổi engine hiện **cạnh** danh sách trường lệch, không trộn vào | Nguyên tắc "package version ≠ binary thực chạy" | Không phân biệt → nêu rõ đây là lý do thông thường khiến fingerprint dịch chuyển |
| `check-failed` dựa trên `lastObservationError` **được ghi lại**, không suy ra từ chỗ thiếu observation | §9c — chạy migration trên **bản sao** store thật | Suy ra từ "có `lastOpenedAt` nhưng không có observation" → báo sai `check-failed` cho profile không hề hỏng |

## 9b. `binaryInfo()` có hai trường version — app đang đọc đúng trường

Kiểm 2026-09-10 trên máy này:

```json
{ "version": "145.0.7632.109.2",
  "bundledVersion": "146.0.7680.177.5",
  "tier": "free",
  "platform": "darwin-arm64" }
```

`bundledVersion` là bản "mới nhất trên mọi nền tảng" mà package khai — **không phải** bản
chạy ở đây. `version` là bản đã giải theo nền tảng. `IdentityService.currentEngineVersion()`
đọc `binaryInfo().version`, tức là **đúng** trường; nếu đọc nhầm `bundledVersion` thì mọi
profile trên Mac sẽ bị báo drift engine vĩnh viễn với một bản chưa từng tồn tại cho darwin.

Vẫn còn một khoảng cách chưa lấp: `version` là **marker của package**, còn binary tự khai
`Chromium 145.0.7632.109` khi chạy `--version` (hậu tố `.2` là số hiệu patch của
CloakBrowser, binary không báo). Hai cái khớp nhau ở bộ ba Chromium, nhưng app **chưa** so
chúng — nếu người dùng đặt `CLOAKBROWSER_BINARY_PATH` trỏ vào một build khác thì marker sẽ
nói dối mà không ai biết. Đây chính là §16.2 còn lại.

---

## 9c. Chạy migration trên bản sao store thật đã bắt được một lỗi suy luận

Sau khi viết xong v7→v8, chạy migration trên một **bản sao** của
`~/Library/Application Support/uiauia-login/cloak.json` (bản gốc không mở, kiểm lại sau
đó vẫn ở `version: 2`).

Hai điều lộ ra mà unit test không bắt được:

1. **Store thật còn ở schema v2**, không phải v7. Migration ghi cứng
   `schemaVersion: 7` vào baseline promote ra — tức là một phỏng đoán được trình bày như
   một bản ghi. Sửa: đọc `this.db.data.version` **trước** khi ghi đè, và ghi đúng con số
   đó (`2`).

2. **Profile đó bị báo `check-failed` trong khi không có phép kiểm tra nào từng chạy.**
   Logic ban đầu suy ra thất bại từ "đã có `lastOpenedAt` nhưng không có
   `lastObservation`". Nhưng profile mới migrate thì đương nhiên không có observation —
   app chưa từng có cơ hội nhìn. Vắng mặt không phân biệt được *"chưa từng nhìn"* với
   *"đã nhìn và không thấy gì"*.

   Sửa theo bằng chứng: thêm `lastObservationError`, ghi lại bởi
   `recordObservationFailure()` khi phép đọc thật sự ném lỗi. `check-failed` chỉ xuất
   hiện khi có bản ghi thất bại và nó mới hơn lần đọc thành công gần nhất. Sau khi sửa,
   cùng dữ liệu đó cho ra:

   ```
   acc 1 | seed <đã ẩn> | platform windows | baseline from schema v2
     state: insufficient
     reason: Có baseline nhưng chưa có lần đo nào sau đó. Mở profile một lần để có dữ liệu so sánh.
   ```

   Seed và persona `windows` giữ nguyên dù host là Mac và mặc định mới là `macos`.

Đây đúng là kiểu lỗi mà kế hoạch cảnh báo: *"Probe lỗi với collision"* — chỉ ở tầng
khác, giữa **phép đo không chạy** và **phép đo chạy mà hỏng**.

---

## 9d. Hành vi cửa sổ trên máy thật — và một suy diễn suýt bị ghi thành kết luận

`scripts/verify-windows/display-probe.ts`, 2026-09-11, MacBook Retina (màn logic
1800×1169, DPR 2). Kết quả đầy đủ ở `TECHNICAL.md` §9.1d. Mọi kiểm PASS: `screen` khớp
màn hình thật, mở tab mới **không** xê dịch cửa sổ (đúng như `viewport: null` được kỳ
vọng), cửa sổ trở lại kích thước cũ sau fullscreen, và `screen`/DPR/`colorDepth` giống
hệt qua một lần đóng–mở lại.

Điểm đáng ghi lại là chỗ **suýt sai**. Khi gọi `requestFullscreen()`,
`document.fullscreenElement` được set nhưng viewport không đổi. Bản kiểm đầu tiên viết
thẳng thành:

```
FAIL  window.innerHeight follows fullscreen (as real Chrome does)
```

Câu đó khẳng định Chrome thật làm khác — mà **chưa hề kiểm Chrome thật**. Chạy đúng
chuỗi đó trên Google Chrome nguyên bản, cùng điều kiện Playwright headed:

```
before   {"innerH":987, "fullscreen":false}
fullscr  {"innerH":987, "fullscreen":true}
rendered height: 1974 -> 1974
```

Giống hệt. Một Chromium headed bị lái qua CDP **không** nhận chuyển cảnh fullscreen của
macOS — đúng cho cả CloakBrowser lẫn Chrome. Gán hành vi này cho binary vá sẽ là quy kết
sai nguyên nhân, đúng thứ kế hoạch cấm.

Probe nay **tự chạy control đó**, và chỉ báo FAIL khi CloakBrowser khác Chrome nguyên
bản. Ngoài ra nó đọc kích thước ảnh render thật từ header PNG của screenshot, để phân
biệt *"cửa sổ không đổi"* với *"cửa sổ có đổi nhưng JS báo số đông cứng"* — hai thứ
trông giống nhau nếu chỉ đọc `innerHeight`.

Giới hạn: toàn bộ chạy dưới automation. **Fullscreen/resize do người dùng tự bấm chưa
được kiểm** — cần điều khiển tầng OS, chưa làm.

---

## 9e. Marker của package không phải bằng chứng về binary — nay đã so

Nối tiếp §9b. `engine-info.ts` hỏi thẳng binary `--version` rồi so với marker package
giải ra, trên phần Chromium 4 số (marker có thêm số hiệu patch của CloakBrowser mà binary
không khai).

Đo trên máy này 2026-09-11:

```
markerVersion   145.0.7632.109.2
binaryVersion   145.0.7632.109      <- binary tự khai
bundledVersion  146.0.7680.177.5    <- "mới nhất mọi nền tảng", KHÔNG có build macOS
tier            free
problems        []
```

Bốn tình huống được **báo** chứ không cái nào bị tự sửa: `not-installed` ·
`unreadable` (có file nhưng không trả lời — **không** mặc định coi là khớp) ·
`version-mismatch` · `pin-unsatisfied`. Trường hợp thực tế mà nó chặn:
`CLOAKBROWSER_BINARY_PATH` trỏ sang build khác, trong khi identity lock vẫn chăm chỉ
ghi con số của package — bản ghi thành hư cấu mà không ai nhận ra.

---

## 10. Khuyến nghị (chưa triển khai, cần quyết định của người dùng)

1. **Không tuyên bố chống WebRTC leak trên macOS** trong `TECHNICAL.md`/UI cho tới khi
   đo được qua proxy. Flag đang truyền là flag chết.
2. **Cân nhắc cảnh báo trong app** khi ≥2 profile cùng chạy trên host macOS free-tier:
   canvas export + audio của chúng giống hệt nhau.
3. **Vẫn nên chạy tài khoản giá trị cao trên Windows** — kết luận cũ không đổi, nhưng
   nay có lý do chính xác hơn: không phải "Mac thiếu patch canvas" mà là "patch canvas
   của Mac không phủ đường export".
