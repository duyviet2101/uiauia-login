# Kế hoạch kiểm chứng và cải thiện uiauia-login trên macOS

| | |
|---|---|
| Phiên bản | v2 (bản gốc của người dùng + 10 điểm vá) |
| Ngày | 2026-09-09 |
| Repo chính | `/Users/duyviet/workspaces/login-anti-detect/uiauia-login` |
| Trạng thái | Đã thực thi phần local — xem §0.5 |
| App version | v0.4.3 · `cloakbrowser@^0.5.10` |

Ký hiệu trạng thái dùng xuyên suốt:

- `[ ]` chưa làm
- `[~]` đang làm
- `[x]` hoàn thành (có artifact kèm theo)
- `[!]` pending vì thiếu điều kiện (proxy / phần cứng / máy Windows)

Mỗi mục hoàn thành phải ghi **đường dẫn artifact** ngay trên dòng đó.

---

## 0. Thay đổi so với bản gốc

Ghi lại để có thể audit ngược. Bản gốc giữ nguyên khung 8 giai đoạn; 10 điểm dưới đây được thêm/sửa vì đối chiếu với code và binary thực tế.

| # | Thay đổi | Lý do |
|---|---|---|
| 1 | **Thêm G0.5 — trích danh sách switch từ binary** | Đã làm thử: lật ngược một giả định lớn (xem §3.1). Không có bước này thì G4 là đoán mò. |
| 2 | **Thêm G2.5 — kiểm chứng WebRTC, nâng lên ưu tiên P0** | Binary Mac **không chứa** switch `fingerprint-webrtc-ip` nhưng app vẫn đang truyền. Nếu đúng là no-op thì đây là lỗ hổng nặng hơn canvas trùng. Bản gốc không có mục nào cho việc này. |
| 3 | **Thêm G2.1 — dựng font dictionary macOS** | Dictionary hiện tại dựng từ registry Win10. Không thay thì mọi số liệu font của đợt đo mới lại vô nghĩa y bản cũ. |
| 4 | **Viết lại §10 → G5** | Bản gốc mô tả sai luồng hiện tại và đề ra một bước bất khả thi (không chen được vào `--restore-last-session`). |
| 5 | **Tách G3.5 — ablation từng nhóm flag** | Nhóm C khác nhóm A khoảng 8 nhóm biến cùng lúc; cây quyết định "A lỗi, C không lỗi" không quy được nguyên nhân nếu không ablation. |
| 6 | **Ghi sự thật về version pin trên darwin vào G6** | Chỉ tồn tại đúng một build macOS; mọi asset `darwin-arm64` từ 146 trở lên đều 404. Pin version không phải cần gạt trên Mac. |
| 7 | **Chuyển "IPv6 không tự động là leak" thành công việc code** | Đang là hành vi thật trong `unlinkability.ts`, nên nó là thay đổi hành vi chứ không phải nguyên tắc. |
| 8 | **Thêm G9 — đồng bộ tài liệu cũ** | `docs/TECHNICAL.md` §9.1 + README đang khẳng định kết luận canvas macOS mà đợt này có thể lật lại. |
| 9 | **Thêm điều kiện môi trường vào G0** | Node mặc định của shell là v16 → vitest chết ngay. |
| 10 | **Khai báo trước một pending không thể giải bằng một máy** | Không phân biệt được "hash duy nhất của máy này" với "hash chung của mọi Apple Silicon chạy Chrome 145". Phải ghi pending từ đầu để findings không over-claim. |

---

## 0.5. Trạng thái thực thi (cập nhật 2026-09-09)

Kết quả: [`findings.md`](findings.md) · Cách tái lập: [`verification.md`](verification.md)

| Giai đoạn | Trạng thái | Kết quả / artifact |
|---|---|---|
| G0 — Khảo sát, đóng băng điều kiện | `[x]` | Host M3 Pro / macOS 26.5; binary thực chạy `Chromium 145.0.7632.109` (marker `145.0.7632.109.2`, tier free); npm `0.5.10`; Node v16 mặc định phải thay bằng v22 |
| G0.5 — Khả năng thật của binary | `[x]` | 16 switch `fingerprint*` có mặt; **thiếu** `webrtc-ip`, `noise`, `locale`, `storage-quota`. Ba chuỗi `fingerprinting-*-noise` được giải thích ở findings §2 |
| G1 — Harness đa persona | `[x]` | `--persona/--launch-mode/--opens/--repeats/--seeds/--group/--drop-arg/--extra-arg`; rule theo persona; `Measured<T>` tách `ok/unsupported/error` |
| G2 — Nâng chất lượng phép đo | `[x]` | SHA-256; canvas 2 workload × 2 đường đọc; audio kèm thống kê; font tách availability/metrics + **overlap tập font**; clientRects giữ số thô; WebGL extension list |
| G2.1 — Font dictionary macOS | `[x]` | `persona.ts` — bộ macOS/Windows riêng + tells chéo + họ font người dùng hay tự cài |
| G2.5 — WebRTC (P0) | `[x]` | Giả thuyết leak **bị bác bỏ**; flag là flag chết trên Mac; phát hiện dị thường 0-candidate. findings §7 |
| G3 — Benchmark nền A/B/C | `[x]` | 132 quan sát hợp lệ; 3 report trong `scripts/verify-windows/reports/…-{A,B,C}/` |
| G3.5 — Ablation từng nhóm flag | `[x]` không cần | A và C trùng đúng cùng 3 trục HIGH ⇒ nguyên nhân ở engine, không ở override của app. Cây quyết định G4 chỉ định ablation khi A≠C. Cờ `--drop-arg/--extra-arg` đã sẵn sàng nếu về sau cần |
| G4 — Sửa cấu hình Mac | `[~]` | Đã đổi mặc định persona theo host (có test). **Kiểm tra hiển thị xong** (`display-probe.ts`, 2026-09-11): screen == màn hình thật, mở tab không xê dịch cửa sổ, screen/DPR ổn định qua đóng–mở lại. Phát hiện fullscreen không đổi viewport — **đã đối chứng Chrome nguyên bản, giống hệt** ⇒ do automation, không phải CloakBrowser. Fullscreen/resize **do người dùng tự bấm** và Retina ngoài/đổi monitor/sleep-wake vẫn `[!]` |
| G5 — Preflight trước khi mở website | `[x]` | Đo được request khôi phục đến **sớm hơn `launchPersistentContext` 49 ms** (`session-restore-probe.ts`) ⇒ chọn phương án (a). `BrowserManager.preflight()` gom mọi kiểm tra lên trước launch; profile có phiên cũ + proxy không ra exit IP → `ProxyPreflightError`, không gọi launcher; `forceLaunch` cũng chịu cổng này; TTL 10 phút → 90 giây. 6 test mới khoá cả **thứ tự** lẫn kết quả. findings §8b |
| G6 — Engine và baseline identity | `[~]` | **§16.1 xong**: `reconcilePatch` chỉ còn trường mạng; thêm `enginePatch()`, `forceLaunch(id,{acceptEngine})`, `acceptEngineVersion(id)`, `engineAcceptedAt`; hộp thoại drift có nút riêng cho engine. **§16.3 xong**: `SCHEMA_VERSION` 7→8, tách `baseline` / `lastObservation` / `diagnostics`, `acceptBaseline()` + `recordObservation()`, migration giữ nguyên seed/persona và **không bịa ra observation**. **§16.2 xong**: `engine-info.ts` hỏi thẳng binary `--version` và so với marker của package; bốn tình huống `not-installed` / `unreadable` / `version-mismatch` / `pin-unsatisfied` được **báo**, không cái nào bị tự sửa; banner ở App; 9 test. Trên darwin chỉ tồn tại một build (§8d) nên pin không phải cần gạt thật — vẫn tôn trọng `CLOAKBROWSER_VERSION` nhưng không dựng UI quanh nó |
| G7 — Hiển thị sức khỏe profile | `[x]` | `profile-health.ts` — bốn trạng thái `stable/changed/insufficient/check-failed`, không có điểm số; `ProfileHealth` gắn vào `ProfileRuntime` ở main process nên renderer không tự tính lại; `FingerprintPanel` hiện ba mốc thời gian riêng + bảng `trường/baseline/đo được` + nút chấp nhận. 9 test `profile-health` + 4 test manager |
| G8 — Proxy thực tế | `[~]` | Phần **không** cần proxy đã xong: `ipv6-leak` tách thành `ipv6-present` (low) + `ipv6-shared` (high, chỉ khi cùng IPv6 dưới hai proxy khác nhau); `same-asn-geo` hạ xuống `low` và đổi câu chữ; thêm mức `low` vào `ProxyWarningLevel`. findings §8c. Phần cần proxy thật (exit IP, WebRTC srflx, timezone) vẫn `[!]` |
| G9 — Đồng bộ tài liệu | `[x]` | `TECHNICAL.md` §9.1/§9.1b/§9.1c + §6 và `README.md` đã cập nhật theo số liệu đo; `findings.md` + `verification.md` đã viết |

**Đính chính so với giả định trong plan:** giả thuyết P0 ở §3.1 (WebRTC leak trên Mac)
đã **bị dữ liệu bác bỏ** — binary không phát ICE candidate nào. Hướng triển khai được
sửa theo bằng chứng: vấn đề WebRTC trên Mac không phải *leak* mà là *flag chết* cộng
một *dị thường nhận diện được*. Xem findings §7.

---

## 1. Mục tiêu và phạm vi

Ba đặc tính cần xác định và cải thiện:

1. **Cách ly dữ liệu** — profile không chia sẻ cookie, storage, phiên đăng nhập.
2. **Ổn định identity** — một profile giữ đặc điểm nhất quán qua nhiều lần mở.
3. **Khác biệt giữa profile** — đo cái gì giống, cái gì khác, và giới hạn thực tế của Cloak trên Mac.

Proxy khác nhau nằm trong mục tiêu cuối, nhưng **không** là điều kiện để bắt đầu đo fingerprint local.

Không đặt tiêu chí "mọi thông số phải khác nhau". Hai máy thật có thể trùng CPU, GPU, font, màn hình. Không tuyên bố hai profile tương đương hai máy vật lý độc lập chỉ vì hash khác nhau.

### 1.1 Trần kết quả — đọc trước khi bắt đầu

Ba đường duy nhất có thể phá được chuyện canvas/audio không đa dạng theo seed trên Mac đều **nằm ngoài phạm vi** (Pro license, VM, JS noise). Vì vậy:

> **Mục tiêu KHÔNG phải là làm canvas/audio khác nhau giữa các profile.**
> Mục tiêu là: (a) bằng chứng chính xác về cái gì thật sự liên kết profile trên Mac native, (b) **gỡ các điểm mâu thuẫn** trong persona, (c) sửa các lỗi luồng đã xác định (WebRTC, preflight, engine baseline), (d) tối ưu các trục thực sự có biến thiên.

Nếu cuối đợt canvas vẫn trùng nhau, đó **không phải** thất bại của kế hoạch — miễn là đã chứng minh được bằng dữ liệu và đã nêu đúng mức rủi ro.

### 1.2 Ngoài phạm vi

Proxy gateway · kill switch · firewall · nhân bản profile · Camoufox / đổi engine · VM · remote browser · mua license hoặc đăng nhập lấy key · thay identity của profile người dùng đang dùng · push / tag / phát hành · JavaScript noise để ép canvas/audio/fonts khác nhau.

---

## 2. Bối cảnh kỹ thuật cần xác minh

| Thành phần | File |
|---|---|
| Cấu hình launch | `src/main/launch-args.ts` |
| Vòng đời browser và restore | `src/main/browser-manager.ts` |
| Kiểm tra và khóa identity | `src/main/identity-service.ts` |
| Model dữ liệu | `src/main/types.ts` |
| Lưu profile | `src/main/store.ts` |
| Fingerprint diagnostics | `src/main/fingerprint-probe.ts` |
| Kiểm tra proxy | `src/main/proxy-tester.ts` |
| Cảnh báo liên kết | `src/main/unlinkability.ts` |
| Preferences | `src/main/browser-preferences.ts` |
| Fonts | `src/main/host-fonts.ts`, `src/main/font-baseline.ts` |
| Benchmark | `scripts/verify-windows/` |

Đã quan sát, agent vẫn phải đối chiếu lại code hiện tại:

- App có seed, `userDataDir`, `resolvedIdentity`, persistent context.
- CPU/RAM suy ra từ seed (`deriveHardwareProfile`).
- Screen lấy từ monitor thật (`displayProvider`).
- Có `--restore-last-session` và `--start-maximized`, `viewport: null`.
- `reconcilePatch()` cập nhật engine version trong thao tác chấp nhận IP.
- Proxy preflight cache 10 phút (`PROXY_CHECK_TTL_MS`).
- `sameIpScope()` coi IPv4 cùng `/24` là cùng phạm vi.
- `duplicate()` đã có; không phát triển thêm.
- `platform` nằm trong `LOCKED_IDENTITY_FIELDS` → store **đã** chặn đổi persona trên profile đã khoá. Không cần thêm cơ chế bảo vệ mới.

**Không coi tài liệu audit cũ là nguồn sự thật nếu mâu thuẫn với code.**

---

## 3. Bằng chứng đã thu thập trước khi bắt đầu

Ba mục dưới đây thu được từ **đọc binary và đọc code**, chưa chạy browser. Chúng định hình lại thứ tự ưu tiên nhưng **bản thân chúng vẫn cần G3 xác nhận thực nghiệm**.

### 3.1 Binary Mac thiếu 4 switch so với Windows

`strings` trên `~/.cloakbrowser/chromium-145.0.7632.109.2/Chromium.app/.../Chromium Framework`:

```
CÓ:     fingerprint · -brand · -brand-version · -device-memory · -failure · -fonts-dir
        -gpu-renderer · -gpu-vendor · -hardware-concurrency · -location · -platform
        -platform-version · -screen-width · -screen-height · -taskbar-height · -timezone
KHÔNG:  fingerprint-webrtc-ip · fingerprint-noise · fingerprint-locale · fingerprint-storage-quota
```

Ngoài ra có 3 chuỗi mang dáng **tên feature kiểu Brave**, chưa rõ có bật được qua `--enable-features` không:
`fingerprinting-canvas-image-data-noise`, `fingerprinting-canvas-measuretext-noise`, `fingerprinting-client-rects-noise`.

**Giả thuyết P0:** `--fingerprint-webrtc-ip` mà `launch-args.ts` truyền cho mọi profile đã khoá **bị binary Mac bỏ qua** → WebRTC có thể lộ IP thật sau proxy. → G2.5.

**Giả thuyết P2:** ba feature `fingerprinting-*-noise` có thể là đường vào cho biến thiên canvas/clientRects trên Mac. Rẻ, đáng thử, **không được** coi là hướng chính.

*Cảnh báo phương pháp:* vắng mặt trong `strings` là bằng chứng mạnh nhưng không tuyệt đối. Kết luận cuối phải dựa trên hành vi quan sát được, không dựa trên `strings`.

### 3.2 Không tồn tại binary macOS mới hơn ở bản free

Đã kiểm toàn bộ release của `CloakHQ/cloakbrowser` + thử CDN trực tiếp:

| Version | asset `darwin-arm64` |
|---|---|
| 151.x / 150.x / 148.x (`-pro`) | không có trên GitHub (phân phối qua license) |
| 146.0.7680.177.1 → .5 | **404** |
| 145.0.7632.159.x (9 bản) | không có |
| **145.0.7632.109.2** (2026-03-04) | **200 — build macOS cuối cùng** |

→ Trên Mac, "nâng binary" và "pin version mới hơn" đều không phải cần gạt tồn tại. Ảnh hưởng G6.

### 3.3 Luồng preflight thật khác mô tả trong bản gốc

Đọc `App.tsx handleLaunch` + `BrowserManager.launch`:

- Profile **đã khoá**: `checkLockedIdentity()` chạy **trước** `launchPersistentContext` và ném lỗi trước khi tiến trình browser tồn tại → không website nào được mở. Bản gốc mô tả sai chỗ này.
- Đường thật sự hở: profile **chưa khoá** nhưng đã có session cũ (lock hụt vì proxy lỗi ở lần trước) → `--restore-last-session` bắn ngay lúc launch, không qua kiểm tra nào.
- Đường hở thứ hai: với profile đã khoá, kiểm tra có thể dựa trên **snapshot proxy cache tới 10 phút**, nên "đã kiểm tra" ≠ "IP đúng tại thời điểm mở".

---

## 4. Điều chỉnh kết luận benchmark Mac cũ

Báo cáo cũ: `scripts/verify-windows/reports/2026-09-09T04-57-09-201Z/report.md`

Quan sát cũ: canvas/audio/fontHash trùng cả 3 profile; clientRects trùng 2 profile.

Hạn chế của nó:

- Chạy trên Mac nhưng dùng **Windows persona**.
- Consistency rules hướng Windows.
- Không proxy, không external detector.
- `fontHash` chỉ là danh sách có/không của 20 font, **lấy từ dictionary dựng cho Windows** → gần như vô nghĩa trên Mac.
- Hash 32-bit (FNV-1a) — không đủ để tuyên bố "đầu ra giống hệt nhau".
- Quy tắc đánh giá diễn giải collision thành liên kết thiết bị quá mạnh.

Giữ báo cáo cũ như **dữ liệu lịch sử**, không sửa đè. Báo cáo mới phải nêu lại phạm vi suy luận.

---

## 5. Nguyên tắc triển khai

- Đo trước, sửa sau, đo lại cùng điều kiện.
- Dùng profile thử riêng; **không mở profile thật**.
- Không tự cập nhật binary trước benchmark nền.
- Version phải lấy từ **browser thực chạy**, không chỉ từ package hay cache metadata.
- Mỗi thay đổi gắn với một vấn đề cụ thể hoặc yêu cầu đã chốt.
- Thiếu thiết bị/proxy → ghi `[!]` và tiếp tục phần độc lập.
- Không thêm cơ chế bảo vệ phức tạp ngoài phạm vi chỉ để đạt một tuyên bố tuyệt đối.
- Không chặn profile vì một phép đo nhiễu hoặc thiếu dữ liệu.
- Giữ tương thích dữ liệu cũ; không tự khóa hoặc đổi identity profile cũ.
- **Không đánh đồng:** hash trùng ↔ chắc chắn cùng thiết bị · hash khác ↔ chắc chắn không liên kết được · probe lỗi ↔ collision · package version ↔ binary thực chạy · sửa cấu hình nhận diện Mac ↔ giả lập hoàn chỉnh một model Mac · consistency rules pass ↔ không bị phát hiện.

---

## 6. Bản đồ phụ thuộc

```
G0 ─┬─> G0.5 ─┬─> G1 ─> G2 ─┬─> G3 ─> G3.5 ─> G4 ─> G9
    │         │             └─> G2.5 (P0, chạy sớm nhất có thể)
    │         └─────────────────────────────────> G8 [!] cần proxy
    └─> G5 ┐
    └─> G6 ├── độc lập với benchmark, chạy song song
    └─> G7 ┘   (G7 phụ thuộc G6)
```

**Quy tắc "đo trước sửa sau" chỉ áp cho cấu hình fingerprint (G4).** G5/G6/G7 không đụng fingerprint → được phép chạy song song, không chờ benchmark.

---

## 7. Giai đoạn 0 — Khảo sát và đóng băng điều kiện đo

- [ ] Đọc hướng dẫn repository áp dụng (CLAUDE.md / AGENTS.md nếu có).
- [ ] `git status` — phân biệt thay đổi có sẵn không thuộc nhiệm vụ, giữ nguyên chúng.
- [ ] Đọc và vẽ luồng: tạo → launch → restore → probe → lock → reopen.
- [ ] Ghi: package version, binary path, **binary version thực chạy** (`--version` của chính file nhị phân, không phải `binaryInfo()`), host OS, kiến trúc, model máy, cấu hình màn hình.
- [ ] Đối chiếu `binaryInfo().version` với version thực chạy — nếu lệch, ghi lại và điều tra.
- [ ] Kiểm tra cơ chế tự cập nhật của package đang cài; xác nhận `CLOAKBROWSER_AUTO_UPDATE='false'` có thật sự chặn được.
- [ ] Chọn thư mục profile thử + thư mục report **tách hẳn** khỏi `app.getPath('userData')`.
- [ ] Xác định cách đóng browser và dọn tiến trình mồ côi khi script lỗi giữa chừng.
- [ ] **Ghi điều kiện môi trường:** Node mặc định của shell là v16.20.2 → `npx vitest` chết với `crypto.getRandomValues is not a function`. Dùng Node ≥20.19 (máy có v22.22.1) cho mọi lệnh test/harness.

**Đầu ra:** cập nhật chính file này (checklist + sơ đồ luồng + điều kiện benchmark + danh sách rủi ro).

**Hoàn thành khi:** chỉ rõ được binary nào đang chạy · chạy thử được mà không chạm dữ liệu thật · có danh sách phần đã tồn tại để tránh làm trùng.

---

## 8. Giai đoạn 0.5 — Khả năng thật của binary *(mới)*

- [ ] Trích toàn bộ switch `fingerprint*` từ binary Mac; lưu kết quả thô vào artifact.
- [ ] Đối chiếu với danh sách flag mà `launch-args.ts` đang truyền → lập bảng **flag nào được nhận / flag nào là no-op**.
- [ ] Với mỗi flag nghi no-op, thiết kế một phép đo hành vi để xác nhận (không kết luận chỉ bằng `strings`).
- [ ] Kiểm tra ba chuỗi `fingerprinting-*-noise` là switch, feature, hay chỉ là chuỗi rác; nếu là feature, thử `--enable-features` và đo tác động.
- [ ] Ghi rõ: switch có mặt trong binary ≠ switch có tác dụng.

**Hoàn thành khi:** có bảng "flag app truyền × binary có nhận × đã kiểm chứng bằng hành vi".

---

## 9. Giai đoạn 1 — Chuẩn hóa harness đa nền tảng

Giữ `verify:windows` hoạt động. Mở rộng CLI hiện có hoặc tạo CLI chung; **không nhân đôi toàn bộ probe**.

### Tham số cần có (hoặc tương đương)

persona (macos | windows) · số profile · số lần mở lại · số lần đo trong phiên · seed list cố định · launch mode (app | tối thiểu) · output dir · binary version được chọn · proxy config tùy chọn (không đưa secret vào CLI/log).

### Model observation

- [ ] Run ID · test profile ID · seed
- [ ] Persona · launch mode
- [ ] Lần mở thứ mấy · lần đo thứ mấy
- [ ] Host OS / kiến trúc
- [ ] Package version **và** browser version thực
- [ ] Cấu hình hiển thị · timestamp
- [ ] Kết quả từng phép đo
- [ ] Trạng thái `ok` | `unsupported` | `error` — **không dùng chung `null`** cho "API không hỗ trợ" và "phép đo thất bại"
- [ ] Chi tiết lỗi đã loại bỏ secret

### Consistency rules

- [ ] Chọn rule theo persona.
- [ ] So sánh UA / navigator / client hints theo hiểu biết đúng của từng nền tảng.
- [ ] Không đòi tên model vật lý chính xác nếu browser không công bố.
- [ ] Đánh giá screen/viewport phù hợp cửa sổ headed.
- [ ] Không coi cùng renderer hoặc cùng font list là lỗi mặc định.
- [ ] **Không dùng kết quả thiếu để tạo collision.**
- [ ] Thêm rule mới: **stack render thật có mâu thuẫn với OS khai báo không** (ví dụ chuỗi renderer nói `Direct3D11` trên host macOS thì bộ extension/parameter WebGL phải được ghi lại để đối chiếu).

**Hoàn thành khi:** một lần chạy Mac không bị chấm bằng bộ rule Windows · report nêu rõ host khác persona · lỗi probe hiển thị tách khỏi trùng fingerprint.

---

## 10. Giai đoạn 2 — Nâng chất lượng phép đo

### 10.1 Font dictionary cho macOS *(mới, chặn G3)*

- [ ] Dựng baseline font macOS thật từ máy đang dùng (`/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`), ghi rõ nguồn và phiên bản OS.
- [ ] Tách dictionary theo persona: bộ Windows hiện có giữ nguyên cho persona Windows; bộ macOS mới cho persona macOS.
- [ ] Giữ `WINDOWS_FONT_BASELINE` và `findNonStandardFonts` hoạt động như cũ cho luồng Windows (không phá tính năng đang chạy tốt).
- [ ] Ghi chú: font "non-standard" trên Mac mang ý nghĩa khác trên Windows — người dùng Mac cài font qua Font Book rất phổ biến.

### 10.2 Canvas

- [ ] Ít nhất **hai workload**: chữ và hình học thuần.
- [ ] Cố định kích thước, font request, nội dung, màu, thứ tự vẽ.
- [ ] Lưu **digest mạnh** (SHA-256, bỏ FNV-1a 32-bit) + đủ dữ liệu để đối chiếu đầu ra thật.
- [ ] Đo lặp trong phiên để phát hiện biến động.
- [ ] Khi hai digest khác nhau, phải nói được khác ở **dữ liệu render** hay ở **serialization**.

### 10.3 Audio

- [ ] Workload cố định.
- [ ] Lưu digest **cùng vài thống kê đầu ra giải thích được** (min/max/mean/số mẫu khác 0).
- [ ] Phân biệt: không hỗ trợ · timeout · đầu ra hợp lệ.
- [ ] Đo nhiều lần, không kết luận từ một lần chạy.

### 10.4 Fonts — tách hai phép đo

- [ ] **Availability:** danh sách font có khả năng tồn tại.
- [ ] **Metrics:** width/geometry cho nhiều chuỗi × nhiều size × nhiều font.
- [ ] Không gọi availability hash là "toàn bộ fingerprint font".

### 10.5 Client rects

- [ ] Workload DOM cố định.
- [ ] Lưu giá trị rect thô + quy tắc chuẩn hóa số đã dùng.
- [ ] Không làm tròn quá mức khiến khác biệt biến mất.
- [ ] Ghi viewport, zoom/DPR quan sát được.

### 10.6 Các trường khác

UA + client hints · platform · CPU/RAM công bố · screen / availScreen / DPR / viewport · WebGL vendor/renderer + tham số cần thiết · timezone / languages · các trường hiện có đủ hữu ích để phát hiện drift.

### 10.7 Context

- [ ] Thử trang chính và iframe.
- [ ] Worker chỉ thử API được hỗ trợ; **thiếu API trong worker không phải lỗi**.

**Hoàn thành khi:** trả lời được "đầu ra thật giống nhau hay chỉ phép băm/tóm tắt giống nhau", trong phạm vi dữ liệu đã thu.

---

## 11. Giai đoạn 2.5 — Kiểm chứng WebRTC *(mới · P0)*

Xuất phát từ §3.1. Đây là câu hỏi ưu tiên **cao hơn canvas**, vì nó liên quan tới lộ IP thật chứ không chỉ liên kết profile.

- [ ] Thêm phép đo ICE candidate vào harness: liệt kê host / srflx / relay candidate, có che phần định danh khi ghi report.
- [ ] Chạy **không proxy** trước: xác định app có truyền `--fingerprint-webrtc-ip` không, và candidate nào xuất hiện.
- [ ] Xác định bằng hành vi xem `--fingerprint-webrtc-ip=<giá trị bịa>` có làm đổi candidate trên binary Mac không. Đây là phép thử quyết định, **không cần proxy**.
- [ ] Nếu là no-op: đánh giá mức rủi ro thật (mDNS obfuscation của Chromium hiện đại có che host candidate không; srflx phụ thuộc STUN đi qua proxy hay không).
- [ ] `[!]` Xác nhận cuối cùng với proxy thật → G8.
- [ ] Ghi kết luận vào findings kèm mức bảo đảm chính xác. **Không tuyên bố "không leak" nếu chưa đo qua proxy.**

**Hoàn thành khi:** biết chắc flag có tác dụng hay không trên Mac, và biết đường phơi nhiễm thật là gì.

---

## 12. Giai đoạn 3 — Benchmark nền trên Mac

### Ma trận chính

| Nhóm | Persona | Launch | Số profile | Số lần mở | Mục đích |
|---|---|---|---:|---:|---|
| A | macOS | Cấu hình app | 3 | 5 | Đánh giá mục tiêu chính |
| B | Windows | Cấu hình app | 3 | 5 | Tái kiểm chứng kết quả cũ |
| C | macOS | Cloak tối thiểu | 3 | 5 | Đối chứng override của app |

- [ ] Mỗi phiên đo **ít nhất 3 lần** cùng workload.
- [ ] Cùng seed list giữa các nhóm, **thư mục profile riêng** cho mỗi nhóm; không dùng chung `userDataDir` giữa các cấu hình.
- [ ] Chạy tuần tự để giảm nhiễu tài nguyên.
- [ ] Không thay engine / monitor / cấu hình host giữa các nhóm; nếu buộc phải thay, ghi lại.
- [ ] Đọc wrapper đang cài để xác định defaults của "launch tối thiểu"; giữ tương đương những điều kiện cần so sánh, đặc biệt **headed mode** và **engine version**.
- [ ] Ghi đầy đủ khác biệt launch A↔C (dự kiến ~8 nhóm biến: `stealthArgs`, screen, cores/mem, extension, prefs, viewport, start-maximized, restore).

### Phân tích — tách bốn loại

- [ ] Biến động **trong cùng phiên** (nhiễu đo).
- [ ] Biến động **giữa các lần mở** của cùng profile (drift).
- [ ] Giống/khác **giữa các profile** (linkage).
- [ ] **Mâu thuẫn nội tại** trong cùng profile (consistency).

Không chọn seed mới chỉ để báo cáo đẹp hơn.

**Hoàn thành khi:** có bảng kết quả tái lập cho A/B/C và câu trả lời có bằng chứng cho canvas, audio, fonts, clientRects.

---

## 13. Giai đoạn 3.5 — Ablation từng nhóm flag *(mới, tách khỏi G4)*

Bắt buộc chạy khi A và C khác nhau ở bất kỳ trục nào. Không có bước này thì mọi quy nguyên nhân từ A↔C đều vô giá trị.

- [ ] Lập danh sách nhóm biến A↔C.
- [ ] Chạy A trừ đi **một nhóm** mỗi lần, giữ nguyên phần còn lại.
- [ ] Ưu tiên theo thứ tự: `fingerprint-platform` → `stealthArgs:false` → screen → CPU/RAM → viewport/DPR → extension/prefs.
- [ ] Mỗi lần ablation lặp đủ số lần đo như G3 (không rút ngắn để tiết kiệm).

**Hoàn thành khi:** mỗi khác biệt A↔C được quy về một nhóm flag cụ thể, hoặc được ghi rõ là "không quy được, cần thêm dữ liệu".

---

## 14. Giai đoạn 4 — Điều tra và sửa cấu hình Mac

**Chỉ bắt đầu sửa fingerprint sau khi G3 + G3.5 xong.**

### Cây quyết định

| Quan sát | Hành động |
|---|---|
| A có vấn đề, C không | Điều tra override của app (đã có kết quả ablation từ G3.5) |
| A và C đều có | Kiểm tra thêm workload + giới hạn engine; **không tự kết luận nguyên nhân C++** |
| B có vấn đề nhưng A không | Ghi rõ hạn chế của cross-platform persona |
| Chỉ một lần đo bất thường | Kiểm tra nhiễu/timing trước |
| Các profile giống nhau nhưng ổn định và nhất quán | Báo **shared surface**; không tự coi là bug |

### Override cần ưu tiên kiểm tra

`fingerprint-platform` · CPU/RAM · screen dimensions · viewport/DPR · nhóm flags mặc định bị bỏ do `stealthArgs:false`.

Thay **từng nhóm** trong test, tránh sửa hàng loạt.

### Persona Mac

Persona = tập thông tin browser công bố **nhất quán**, không phải bộ giả lập hoàn chỉnh một model Mac.

- [ ] Không thêm model M3/M4 giả định.
- [ ] Không ép mọi CPU/GPU/screen phải khác nhau.
- [ ] Có thể chọn native Mac làm mặc định **cho profile mới** nếu dữ liệu ủng hộ. Profile cũ giữ nguyên lựa chọn — `store.update` đã chặn sẵn vì `platform ∈ LOCKED_IDENTITY_FIELDS`, chỉ cần đổi mặc định trong `store.create` và ghi hướng dẫn migrate thủ công.
- [ ] Chỉ thêm preset khi có tổ hợp đã kiểm nghiệm **và** nhu cầu rõ ràng.

### Hiển thị — kiểm tra trên phần cứng hiện có

- [x] Mở tab · maximize/fullscreen · đóng/mở lại → `scripts/verify-windows/display-probe.ts`, mọi kiểm PASS. Fullscreen không làm viewport đổi, nhưng **Chrome nguyên bản trong cùng điều kiện cũng vậy** — probe tự chạy control và chỉ FAIL khi hai bên khác nhau.
- [x] Retina (màn hình tích hợp) → DPR 2, `screen` khớp 1800×1169, ổn định qua đóng–mở lại.
- [!] Resize / maximize / fullscreen **do người dùng tự bấm** → cần điều khiển tầng OS (accessibility), chưa làm. Những gì đo được là geometry sau `--start-maximized`, sau khi mở tab, và sau khi mở lại.
- [!] Màn hình ngoài · đổi monitor · sleep/wake → mục kiểm thử riêng, **không tự đưa máy vào sleep**, giữ pending.

**Hoàn thành khi:** mỗi sửa đổi có reproduction trước sửa, kết quả sau sửa, và không gây regression cửa sổ quan sát được.

---

## 15. Giai đoạn 5 — Preflight trước khi mở website *(viết lại)*

### Vấn đề thật (theo §3.3, không theo mô tả bản gốc)

1. Profile **chưa khoá** có session cũ → `--restore-last-session` mở lại website ngay lúc launch, không qua kiểm tra nào.
2. Profile **đã khoá** có thể được duyệt bằng snapshot proxy **cũ tới 10 phút**.

Profile đã khoá đi đường bình thường thì **đã** kiểm tra trước khi tiến trình browser tồn tại — chỗ này không cần sửa, chỉ cần thêm test khoá hành vi lại.

### Ràng buộc thiết kế

`--restore-last-session` do **Chromium** thực thi lúc khởi động; app không chen được vào giữa. Chỉ có hai cách hợp lệ:

- **(a)** mọi kiểm tra phải hoàn tất **trước** khi gọi `launchPersistentContext` — đúng như đường locked hiện tại; hoặc
- **(b)** bỏ flag và tự khôi phục tab qua Playwright sau khi kiểm tra đạt.

**Không** chặn/route request giữa chừng (nằm ngoài phạm vi, và để lại dấu vết CDP).

### Công việc

- [x] Xác định chính xác thời điểm restore bắt đầu (đo, không suy luận). → request đến **sớm hơn 49 ms** so với lúc `launchPersistentContext` trả về.
- [x] Dựng endpoint local để ghi request đến — dùng làm "website thử". → `scripts/verify-windows/session-restore-probe.ts`, chỉ chạm `127.0.0.1`.
- [x] Tái hiện cả hai trường hợp: preflight đạt và preflight hỏng. → test `browser-manager.test.ts`: đạt thì thứ tự là `['proxy-test','launch']`; hỏng thì `launcher` **không** được gọi.
- [x] Chọn (a) hoặc (b) theo dữ liệu → **(a)**. Số đo cho thấy (b) không cần thiết: chặn trước launch là đủ, vì không có tiến trình nào thì không có gì để khôi phục.
- [x] Xử lý đường hở #1 → proxy của profile chưa khoá được test trong `preflight()`, trước launch; snapshot tái dùng để khoá nên không test hai lần.
- [x] Xử lý đường hở #2 → TTL 10 phút là cache chứ không phải cửa sổ bàn giao; hạ xuống **90 giây**, đủ cho chuỗi precheck → launch của một thao tác, và snapshot **thất bại** không bao giờ được tái dùng.
- [x] Giữ nguyên danh sách tab và hành vi khôi phục hợp lý — cờ `--restore-last-session` **không bị đụng tới**; probe xác nhận tab cũ vẫn quay lại sau khi mở lại.
- [ ] Rà request nền từ session, service worker, và từ chính browser. → **chưa làm**: cần proxy/gateway để quan sát toàn bộ lưu lượng; probe hiện chỉ thấy request tới đúng endpoint local.

### Giới hạn phải ghi rõ

Không có gateway/firewall thì **không tuyên bố** "không một byte nào ra mạng trước kiểm tra". Triển khai phần khả thi, nêu đúng giới hạn. Không thêm gateway để giải quyết.

**Hoàn thành khi:** website thử không được mở bởi luồng restore trước khi kiểm tra đạt · kiểm tra hỏng thì người dùng thấy lý do · không mất tab · report mô tả chính xác mức bảo đảm.

---

## 16. Giai đoạn 6 — Engine và baseline identity

### 16.1 Tách hai hành động

**"Chấp nhận IP mới"** — chỉ cập nhật trường mạng cần thiết; **không** đổi browser version hoặc fingerprint baseline âm thầm.

> Bug đã xác định: `IdentityService.reconcilePatch()` luôn gắn `cloakBrowserVersion: versionProvider()`, và nút "Mở & cập nhật IP" gọi `forceLaunch` → `reconcileLockedIdentity(reconcilePatch(...))`. Nhấn chấp nhận IP = âm thầm chấp nhận engine mới.

**"Chấp nhận engine mới"** — thao tác riêng, có kiểm tra và so sánh baseline, **không** áp dụng tự động lên profile thật trong đợt này.

- [ ] Tách `reconcilePatch` thành hai phần (mạng / engine).
- [ ] Thêm luồng riêng cho việc chấp nhận engine, mặc định tắt.
- [ ] Test khoá hành vi: chấp nhận IP **không** đổi `cloakBrowserVersion`.

### 16.2 Chọn engine

- [x] Dùng API version pin của package nếu hỗ trợ → đọc `CLOAKBROWSER_VERSION`, báo `pin-unsatisfied` khi không thoả.
- [x] So sánh version yêu cầu ↔ version thực chạy → `describeEngine()` so marker của package với thứ binary tự khai qua `--version`, trên phần Chromium 4 số (`chromiumPartOf`). Đo trên máy này: `145.0.7632.109.2` vs `145.0.7632.109`, khớp.
- [x] Thiếu binary → **báo lỗi rõ, không fallback âm thầm** → `not-installed`, và binary không trả lời là `unreadable` chứ **không** mặc định coi là khớp.
- [x] Không tự tải/nâng engine để thay cho benchmark nền → không có đường code nào tải hay đổi engine; chỉ báo.
- [x] Không coi việc giữ binary cũ vô hạn là chiến lược bảo mật → ghi thẳng trong `TECHNICAL.md` §6.2 rằng đó chỉ là tình trạng hiện tại của nguồn tải.
- [x] **Ghi vào tài liệu sự thật ở §3.2:** trên darwin chỉ tồn tại một build; pin version không phải cần gạt. Không thiết kế UI xoay quanh khả năng không có thật. Pin tới bản `-pro` mà không có license sẽ dẫn tới license exit code 76–79.

### 16.3 Baseline

Phân biệt ba khái niệm: **baseline đã chấp nhận** · **observation mới nhất** · **diagnostics đầy đủ gần nhất**.

- [x] Lưu schema version và engine version kèm baseline. → `FingerprintBaseline { fingerprint, acceptedAt, engineVersion, schemaVersion, source }`.
- [x] **Không tự ghi đè baseline khi drift.** → `recordObservation()` không đụng baseline; `acceptBaseline(..., 'first-launch')` **ném lỗi** nếu đã có baseline. Có test ghi nhận observation lệch mà baseline giữ nguyên.
- [x] Profile cũ chưa có baseline mới → hiển thị "chưa đủ dữ liệu", không tự kết luận lỗi. → `insufficient`, và câu chữ nói rõ profile có từ trước khi app lưu baseline.
- [x] Bump `SCHEMA_VERSION` (hiện 7) → **8**, migration promote `fingerprint` cũ thành baseline (`schemaVersion: 7`, `engineVersion: 'unknown'` khi không ai ghi lại), `lastObservation` để **null** thay vì bịa ra một lần đo. Test khoá seed/persona không đổi.

**Hoàn thành khi:** có test chứng minh chấp nhận IP không chấp nhận engine, và observation mới không phá baseline cũ.

---

## 17. Giai đoạn 7 — Hiển thị sức khỏe profile

Giữ UI nhỏ, bốn trạng thái: **ổn định so với lần đo trước** · **có thay đổi cần xem** · **chưa đủ dữ liệu** · **phép kiểm tra thất bại**.

- [x] Chi tiết cho biết trường nào đổi, ở lần đo nào. Không dùng điểm số an toàn tùy ý. → bảng `trường / baseline / đo được`, cộng ba mốc thời gian riêng (baseline chấp nhận · đo gần nhất · diagnostics đầy đủ). Không có điểm số nào.
- [x] Khi so sánh giữa profile: dùng "giống ở phép đo X", tránh "chắc chắn cùng máy". → giữ nguyên `unlinkability.ts`, và §8c hạ hai cảnh báo không đủ bằng chứng xuống mức `low`.
- [x] Không thêm dashboard lớn — toàn bộ nằm trong `FingerprintPanel` sẵn có.

---

## 18. Giai đoạn 8 — Kiểm tra proxy thực tế `[!]`

Chỉ dùng proxy thử **được cung cấp rõ ràng**. Không lấy proxy từ profile thật.

- [!] Mỗi profile một proxy riêng.
- [!] Đo exit IP trên browser thật.
- [!] So sánh timezone, languages, WebRTC quan sát được.
- [!] Phân biệt **proxy endpoint** với **exit IP**.
- [!] Xác nhận kết luận WebRTC của G2.5 qua proxy thật.
- [x] **Thay đổi hành vi code:** `ipv6-leak` → `ipv6-present` (`low`) + `ipv6-shared` (`high`, chỉ khi cùng IPv6 dưới hai proxy khác nhau). Xong, không cần proxy.
- [x] Xem lại `same-asn-geo`: hạ xuống `low`, câu chữ nói thẳng đây không phải bằng chứng liên kết.
- [!] Không lưu credentials ở bất kỳ artifact nào.

Thiếu proxy → đánh dấu pending, **không chặn phần local**.

---

## 19. Giai đoạn 9 — Đồng bộ tài liệu *(mới)*

- [ ] Cập nhật `docs/TECHNICAL.md` §9.1 (kết luận canvas/audio macOS) theo dữ liệu mới.
- [ ] Cập nhật §9.2 / §9.3 / §9.7 nếu G4 đổi cấu hình.
- [ ] Cập nhật khuyến nghị "nên chạy trên Windows" trong `README.md` theo kết quả thật.
- [ ] Ghi rõ trong tài liệu: đâu là kết luận đã kiểm chứng trên Mac, đâu là kết luận chỉ đúng trên Windows.

Không để lại hai tài liệu mâu thuẫn nhau trong repo.

---

## 20. Kiểm thử regression

- [ ] Consistency rules đúng persona.
- [ ] Probe lỗi/unsupported **không** thành collision.
- [ ] Phân tích ổn định không trộn lẫn profile hoặc lần mở.
- [ ] Chấp nhận IP **không** đổi engine.
- [ ] Binary yêu cầu khác binary thực chạy → phát hiện được.
- [ ] Baseline không bị observation ghi đè.
- [ ] Preflight thất bại → không mở URL đã lưu.
- [ ] Migration dữ liệu cũ không đổi seed/persona.
- [ ] Cảnh báo IPv6 chỉ bắn khi thật sự ngoài phạm vi proxy.

Chạy test suite + build (**Node ≥20.19**). Chỉ tuyên bố "Windows runtime đã kiểm chứng" nếu thực sự chạy trên Windows.

---

## 21. Artifact và bàn giao

```
docs/macos-isolation/implementation-plan.md    ← file này
docs/macos-isolation/findings.md
docs/macos-isolation/verification.md
scripts/<harness>/reports/<timestamp>/         ← report + raw observations
```

Raw observations và metadata phải **đã loại bỏ secret** (proxy credentials, IP thật của người dùng).

`findings.md` gồm: điều kiện thử · hạn chế của benchmark cũ · ma trận trước/sau · trường trùng / drift / mâu thuẫn · nguyên nhân đã xác định và giả thuyết chưa xác nhận · thay đổi code · phần chưa thực hiện và lý do.

---

## 22. Definition of done

Phần local hoàn thành khi:

- [ ] Benchmark Mac native (A) và đối chứng (C) chạy xong, có ablation khi cần.
- [ ] Kết luận fingerprint trùng được **cập nhật dựa trên dữ liệu mới**, không copy kết luận cũ.
- [ ] Câu hỏi WebRTC đã trả lời bằng hành vi quan sát được.
- [ ] Các sửa đổi có căn cứ đã triển khai và kiểm tra.
- [ ] Luồng IP/engine không còn chấp nhận thay đổi engine ngầm.
- [ ] Baseline và observation được phân biệt.
- [ ] Preflight/restore có hành vi kiểm chứng được, giới hạn ghi rõ.
- [ ] Tests/build đạt.
- [ ] Tài liệu cũ đã đồng bộ, không còn mâu thuẫn.
- [ ] Không đụng profile thật · không phát hành.
- [ ] Mục phụ thuộc proxy / Windows host / phần cứng khác được ghi pending **trung thực**.

**Không coi "mọi hash khác nhau" là definition of done.**

---

## Phụ lục A — Câu hỏi mở không giải được bằng một máy

| Câu hỏi | Vì sao không giải được tại chỗ | Hướng giải |
|---|---|---|
| Canvas hash dùng chung trên Mac là **duy nhất của máy này** hay **chung cho mọi Apple Silicon chạy Chrome 145**? | Cần điểm đối chứng bên ngoài; dữ liệu một máy không phân biệt được. Hai khả năng khác nhau hoàn toàn về mức rủi ro. | Đo trên một Mac thứ hai, hoặc đối chiếu dữ liệu công khai. Trước khi có: ghi **pending**, không kết luận mức rủi ro. |
| Hành vi thật khi có proxy (WebRTC, exit IP, tz) | Không có proxy thử | G8 |
| Regression trên Windows sau khi sửa | Không có máy Windows trong đợt này | Ghi pending + hướng dẫn kiểm thử |
| Retina / màn hình ngoài / sleep-wake | Cần thao tác phần cứng | Kiểm thử riêng, không tự động hoá |

## Phụ lục B — Dữ liệu thô đã đo (2026-09-09, trước khi bắt đầu)

**B.1 — Switch `fingerprint*` trong binary Mac 145.0.7632.109.2** *(nguồn: `strings` trên Chromium Framework)*

```
CÓ:     fingerprint, fingerprint-brand, fingerprint-brand-version, fingerprint-device-memory,
        fingerprint-failure, fingerprint-fonts-dir, fingerprint-gpu-renderer, fingerprint-gpu-vendor,
        fingerprint-hardware-concurrency, fingerprint-location, fingerprint-platform,
        fingerprint-platform-version, fingerprint-screen-height, fingerprint-screen-width,
        fingerprint-taskbar-height, fingerprint-timezone
KHÔNG:  fingerprint-webrtc-ip, fingerprint-noise, fingerprint-locale, fingerprint-storage-quota
KHÁC:   fingerprinting-canvas-image-data-noise, fingerprinting-canvas-measuretext-noise,
        fingerprinting-client-rects-noise   (dạng tên feature, chưa rõ cách bật)
```

**B.2 — Tình trạng build macOS ở bản free** *(nguồn: GitHub Releases API + HEAD trực tiếp lên CDN)*

`chromium-v145.0.7632.109.2` (2026-03-04) là release cuối cùng có asset `cloakbrowser-darwin-arm64.tar.gz` (HTTP 200). Mọi version 146+ trả 404 cho asset darwin. Các bản 148/150/151 đều là `-pro`, không phát hành binary trên GitHub.

**B.3 — Luồng launch hiện tại** *(nguồn: đọc code)*

`App.handleLaunch` → (nếu có proxy) `precheckProxy` → `api.launch` → `BrowserManager.launch`:
nếu `identityLocked && !force` thì `checkLockedIdentity()` chạy **trước** `launchPersistentContext`; snapshot proxy có thể lấy từ cache TTL 10 phút. Profile chưa khoá đi thẳng vào `launchPersistentContext` với `--restore-last-session`.

> Cả ba mục phụ lục B đều từ **đọc binary / đọc code**, chưa chạy browser. Phải được G0.5–G3 xác nhận bằng hành vi trước khi dùng làm căn cứ kết luận.
