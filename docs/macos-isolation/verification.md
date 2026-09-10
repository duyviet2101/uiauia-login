# Cách tái lập và những gì đã chạy

## Yêu cầu môi trường

Node ≥ 20.19 (shell mặc định trên máy này là **v16.20.2**, sẽ làm vitest/vite chết
với `crypto.getRandomValues is not a function`):

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"
```

## Harness

Thư mục vẫn tên `scripts/verify-windows/` để báo cáo lịch sử giữ nguyên đường dẫn đã
được trích dẫn, nhưng harness nay chạy theo persona cho cả macOS lẫn Windows.

```bash
npm run verify:mac        # persona macOS
npm run verify:windows    # persona Windows
npm run verify -- --help  # (không có --help; xem cờ bên dưới)
```

Cờ: `--persona macos|windows` · `--launch-mode app|minimal` · `--profiles N` ·
`--opens N` · `--repeats N` · `--seeds a,b,c` · `--group NHÃN` · `--label "..."` ·
`--screen WxH` · `--drop-arg <tiền tố>` (ablation) · `--extra-arg <cờ>` ·
`--proxies <file>` · `--external` · `--keep`.

Profile thử luôn nằm trong thư mục tạm riêng cho mỗi nhóm; không nhóm nào dùng chung
`userDataDir`, và dữ liệu app thật không bị đụng tới.

## Ba lệnh đã chạy để tạo ma trận (2026-09-09)

```bash
npx tsx scripts/verify-windows/cli.ts --persona macos   --launch-mode app     --profiles 3 --opens 5 --repeats 3 --seeds 11111,66666,4242042 --group A
npx tsx scripts/verify-windows/cli.ts --persona windows --launch-mode app     --profiles 3 --opens 5 --repeats 3 --seeds 11111,66666,4242042 --group B
npx tsx scripts/verify-windows/cli.ts --persona macos   --launch-mode minimal --profiles 3 --opens 5 --repeats 3 --seeds 11111,66666,4242042 --group C
```

Sửa cách phân tích mà không phải chiếm máy chạy lại:

```bash
npx tsx scripts/verify-windows/reanalyze.ts scripts/verify-windows/reports/<thư-mục>
```

## Artifact

| Nhóm | Thư mục |
|---|---|
| A — persona macOS, cấu hình app | `scripts/verify-windows/reports/2026-09-09T09-55-37-787Z-A/` |
| B — persona Windows, cấu hình app | `scripts/verify-windows/reports/2026-09-09T09-58-21-971Z-B/` |
| C — persona macOS, engine defaults | `scripts/verify-windows/reports/2026-09-09T09-58-44-867Z-C/` |
| (cũ, giữ nguyên làm dữ liệu lịch sử) | `scripts/verify-windows/reports/2026-09-09T04-57-09-201Z/` |

Mỗi thư mục có `report.md` (đọc được) và `observations.json` (dữ liệu thô).
**Lưu ý:** `scripts/verify-windows/reports/` nằm trong `.gitignore` — artifact chỉ tồn
tại trên máy chạy, không được commit. Muốn giữ lâu dài thì chép ra ngoài repo.
Địa chỉ WebRTC được che (`192.168.x.x`, `<uuid>.local`); so sánh dùng digest của giá
trị đầy đủ nên không cần lưu địa chỉ thật.

## Thí nghiệm rời (không nằm trong harness)

Hai thí nghiệm chạy bằng script tạm rồi xoá, kết quả chép vào `findings.md`:

1. **Đường đọc canvas** — 3 seed × {`toDataURL` png/jpeg/webp, `toBlob`, `getImageData`
   ×2 lần, `measureText`}, đảo cả thứ tự gọi. Kết luận ở findings §2.
2. **WebRTC** — cùng một probe chạy trên **Chrome thật** (control) và 4 cấu hình
   CloakBrowser. Kết luận ở findings §7.

Cả hai đều tái lập được bằng cách dựng lại script từ mô tả trong findings; chúng bị
xoá vì là script dùng một lần, không phải phần của harness.

3. **Thời điểm session restore** — thí nghiệm này **được giữ lại** vì nó khoá một
   tuyên bố mà thiết kế preflight dựa vào:

   ```bash
   npx tsx scripts/verify-windows/session-restore-probe.ts
   ```

   Chỉ chạm `127.0.0.1`, dùng profile tạm trong `$TMPDIR` rồi xoá, không đụng profile
   thật và không cần proxy. In ra thời điểm request của tab được khôi phục **so với**
   lúc `launchPersistentContext` trả về. Kết quả 2026-09-10: **−49 ms** (đến trước).
   Kết luận ở findings §8b.

4. **Còn bản macOS nào mới hơn không** — GitHub Releases API + HEAD lên CDN, không
   đăng nhập:

   ```bash
   curl -s "https://api.github.com/repos/CloakHQ/cloakbrowser/releases?per_page=30"
   curl -sIL -o /dev/null -w "%{http_code}" https://cloakbrowser.dev/chromium-v151.0.7922.108.4/cloakbrowser-darwin-arm64.tar.gz
   ```

   Bảng kết quả ở findings §8d.

5. **Migration v2→v8 trên dữ liệu thật** — chạy `ProfileStore.init()` lên một **bản sao**
   của `~/Library/Application Support/uiauia-login/cloak.json` trong scratchpad. Bản gốc
   không bị mở để ghi; kiểm lại sau đó vẫn ở `version: 2`. Bắt được hai lỗi, xem
   findings §9c.

6. **Hành vi cửa sổ trên phần cứng thật** — giữ lại trong harness:

   ```bash
   npx tsx scripts/verify-windows/display-probe.ts
   ```

   Profile tạm trong `$TMPDIR`, không proxy, không ra mạng ngoài `about:blank`. Tự chạy
   **control Chrome nguyên bản** khi máy có `/Applications/Google Chrome.app`, nên một
   hành vi chỉ bị quy cho CloakBrowser khi nó thật sự khác Chrome. Kết quả ở findings
   §9d / `TECHNICAL.md` §9.1d.

7. **Marker package ↔ binary thực chạy** — `readEngineInfo()` chạy sẵn lúc app khởi
   động và log ra; kiểm tay bằng:

   ```bash
   npx tsx -e "import {readEngineInfo} from './src/main/engine-info'; console.log(await readEngineInfo())"
   ```

   Kết quả ở findings §9e.

8. **Pin engine có thật sự hoạt động không** — vì đây là một option mới trên đường
   launch, nó được chạy thật chứ không chỉ suy luận: launch có pin bằng marker đang cài
   (Chrome/145.0.0.0, cùng binary với lúc không pin), và launch với pin vào một bản
   không tồn tại → `HTTP 404`, **không** âm thầm lùi về bản khác. Kết quả ở findings §9f.

## Kiểm thử đã chạy

| Lệnh | Kết quả |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | sạch |
| `npx vitest run` | **235 pass, 1 skip** (trước đợt này: 176 pass) |
| `npm run build` (electron-vite) | thành công |

Ba test mới trong `tests/store.test.ts`: `defaultPlatformFor` chọn đúng persona theo
host · persona truyền tay luôn thắng mặc định · migration không đổi persona của
profile cũ.

Hai test cũ trong `tests/verify-windows-report.test.ts` được sửa **kỳ vọng** cho khớp
cách diễn đạt mới của verdict (`measurement(s) failed` thay `failed to launch`,
`font.availability` thay `fontHash`) — ý nghĩa kiểm thử giữ nguyên.

Sáu test preflight trong `tests/browser-manager.test.ts` khoá **thứ tự**, không chỉ kết
quả — vì đây là loại lỗi mà một assertion "cuối cùng thì cũng test proxy" sẽ bỏ lọt:

- proxy của profile chưa khoá được test **trước** launch → `['proxy-test', 'launch']`;
- profile có phiên cũ + proxy hỏng → ném `ProxyPreflightError` và `launcher` **không**
  được gọi lần nào;
- lần mở **đầu tiên** với proxy hỏng vẫn mở được (không có phiên nào để replay);
- `forceLaunch` cũng bị chặn — force chấp nhận drift, không bỏ qua xác minh exit;
- snapshot vừa lấy từ `precheckProxy` được tái dùng → proxy chỉ bị test một lần;
- snapshot **thất bại** đã lưu thì không bao giờ được tái dùng, luôn test lại.

`tests/profile-health.test.ts` (9 test) khoá bốn trạng thái sức khoẻ, gồm ba phép
**không** kết luận: profile cũ không có baseline là `insufficient` chứ không phải lỗi ·
`capturedAt` bị loại khỏi phép so · mở được mà không đọc được fingerprint là
`check-failed`, không bao giờ là `stable`. Bốn test trong `browser-manager` khoá việc
observation lệch **không** tự lên làm baseline, và bốn test migration trong `store` khoá
việc v7→v8 giữ nguyên seed/persona và **không bịa ra** một observation chưa từng đo.

Ba test trong `tests/unlinkability.test.ts` khoá cách chấm mức độ mới: IPv6 của một
profile là `low`/`ipv6-present`; hai profile **chung một proxy** thấy chung IPv6 thì
không bị flag; hai profile **khác proxy** thấy chung IPv6 thì `high`/`ipv6-shared`.

## Chưa chạy được

| Hạng mục | Lý do | Cách kiểm tiếp |
|---|---|---|
| Toàn bộ giai đoạn proxy | không có proxy thử | chạy lại 3 lệnh trên kèm `--proxies <file>`, mỗi profile một proxy riêng; đọc mục WebRTC + exit IP trong report |
| WebRTC srflx (qua STUN) | cần proxy | như trên |
| Regression trên Windows | không có máy Windows | chạy `npm run verify:windows` trên máy Windows thật; nhóm B ở đây **không** đại diện cho Windows thật vì host là Mac |
| Canvas hash có phải riêng máy này không | cần máy Mac thứ hai | chạy nhóm A trên một Mac khác, so `canvas.text.export` |
| Fullscreen/resize **do người dùng tự bấm** | cần điều khiển tầng OS (accessibility), automation không tái hiện được | bấm tay rồi đọc `innerHeight`/`screen` trong DevTools của chính profile |
| Màn hình ngoài · đổi monitor · sleep/wake | thao tác phần cứng tay; **không tự đưa máy vào sleep** | cắm màn ngoài rồi chạy lại `display-probe.ts` với `--width/--height` của màn đó |
| Request nền (service worker, request của chính browser) khi khôi phục phiên | probe local chỉ thấy request tới đúng endpoint của nó; muốn thấy **toàn bộ** lưu lượng thì cần gateway — nằm ngoài phạm vi | nếu về sau có proxy thử, đọc log proxy trong 10 giây đầu sau khi mở lại |
| Key miễn phí có tải được build macOS 151 không | ràng buộc nhiệm vụ cấm đăng nhập / lấy key thay người dùng | người dùng tự chạy `cloakbrowser login` rồi kiểm `binaryInfo()` — và cân nhắc rằng đổi engine làm drift mọi identity đang khoá |
| Retina / màn hình ngoài / sleep-wake | cần thao tác phần cứng | kiểm thử tay |
| `--enable-features=fingerprinting-*-noise` | chưa thử | `--extra-arg '--enable-features=...'` rồi so `canvas.text.export` |
