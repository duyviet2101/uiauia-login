# Auto-update (phương án miễn phí) — Design Spec

Ngày: 2026-06-22 · App: uiauia-login (CloakBrowser Manager) v0.2.x · Trạng thái: approved (design)

## 1. Bối cảnh & mục tiêu

Hiện app chỉ **check + thông báo**: `src/main/updater.ts` gọi GitHub API so version, renderer hiện `UpdateBanner` với nút "Tải về" → mở trang release; **người dùng tự tải `.dmg`/`.exe` và cài tay**.

Mục tiêu: bỏ bước thủ công **nhiều nhất có thể mà không tốn chi phí ký số**.

Ràng buộc cố định:
- App đóng gói gửi sang **máy người khác** (Windows + macOS), dùng **thủ công** (không automation).
- **Chưa ký số** (Apple Developer / Windows cert) — quyết định giữ nguyên để khỏi tốn phí.
- `appId = com.cloakbrowser.manager` cố định → cài đè giữ nguyên data (profiles/sessions). KHÔNG được đổi.
- Engine: electron-builder 26 (`electron-builder.yml`), CI build trên runner macOS + Windows thật rồi publish 1 release/tag (`.github/workflows/release.yml`).

## 2. Quyết định đã chốt

**Phương án miễn phí** (đã loại 2 phương án ký số). Lý do của ràng buộc ký số:
- **macOS:** auto-update silent dùng Squirrel.Mac (qua `electron-updater`) **bắt buộc app phải ký Developer ID + notarize** — Squirrel từ chối áp update lên app không ký. Không có cách lách ổn định trên macOS đời mới. → **không** dùng electron-updater cho mac.
- **Windows:** `electron-updater` (NsisUpdater) **chạy được cả khi chưa ký** — chỉ vướng SmartScreen/UAC lần đầu.

Hệ quả thiết kế: hai nền tảng dùng **hai cơ chế khác nhau**, ẩn sau một interface chung.

## 3. Hành vi theo nền tảng

| | Windows | macOS |
|---|---|---|
| Kiểm tra bản mới | `electron-updater` đọc `latest.yml` | GitHub API đọc release mới nhất + assets |
| Tải | electron-updater tải `.exe`(+blockmap), có % | tải `.dmg` đúng arch (arm64/x64), có % |
| Cài | `quitAndInstall()` → NSIS cài đè → tự mở lại | `shell.openPath(dmg)` → Finder hiện kéo-thả; user kéo app vào Applications |
| Tự động hoá | **Đầy đủ** (1 cú bấm "Cài & khởi động lại") | **Bán phần** (auto-download xong, còn 1 thao tác kéo-thả + lần đầu right-click→Open) |

Chung cho cả hai:
- **Renderer khởi xướng check** bằng `update:check` **khi App mount** (đúng pattern hiện tại: renderer gọi `app:get-init-state`/`app:check-update` lúc mount) + nút **"Kiểm tra cập nhật"** thủ công gọi lại cùng path. Main KHÔNG tự check (tránh race với renderer chưa sẵn sàng).
- Up-to-date → **không hiện banner** (state `up-to-date`/`idle`), im lặng.
- Tải chỉ chạy **khi user bấm** (không tự ngốn băng thông). `autoDownload = false`.

## 4. Kiến trúc & thành phần

Giữ đúng pattern hiện có: service ở main process, **dependency injection qua constructor** (như `BrowserManager`/`IdentityService`), event đẩy renderer qua `webContents.send` (như `browser:status-changed`).

```
UpdateService (main)  ── rẽ nhánh theo process.platform, giữ state, đẩy event
   ├─ UpdaterAdapter (interface)        ← để test bằng adapter giả
   │    ├─ WinUpdater   (electron-updater)
   │    └─ MacUpdater   (GitHub API + tải dmg + openPath)
   └─ phát 'update:status' → mọi BrowserWindow
        ▲ IPC (invoke: update:check / update:start / update:apply)
Renderer: UpdateBanner (stateful) ← App lắng nghe 'update:status'
```

### Interface chung (điểm mấu chốt để test được)

```ts
interface UpdaterAdapter {
  /** Có bản mới hơn không (chưa tải). */
  check(current: string): Promise<{ available: boolean; latest: string | null }>;
  /** Bắt đầu tải; báo % qua onProgress; trả về khi sẵn sàng "apply". */
  start(onProgress: (percent: number) => void): Promise<{ ready: boolean; artifactPath?: string }>;
  /** Win: quitAndInstall. Mac: shell.openPath(dmg). */
  apply(): Promise<void>;
  /** Win = true (cài & relaunch). Mac = false (chỉ mở installer). */
  readonly canAutoInstall: boolean;
}
```

- `WinUpdater`: bọc mỏng `autoUpdater` của electron-updater (`autoDownload=false`, `autoInstallOnAppQuit=false`); map sự kiện `checking-for-update`/`update-available`/`download-progress`/`update-downloaded`/`error` vào interface.
- `MacUpdater`: tự gọi GitHub API (mở rộng logic trong `updater.ts` để lấy `assets[]`), `pickDmgAsset(assets, arch)` chọn đúng file, `downloadDmg()` (stream + onProgress) lưu vào `app.getPath('temp')`, `apply()` = `shell.openPath(path)`.
- `UpdateService`: nhận `adapter` + `platform` + hàm `broadcast(status)` qua constructor (inject để test). Giữ `UpdateStatus`, chạy check/start/apply, phát event.

### Thành phần thuần (pure, ưu tiên test)
- `isNewer(latest, current)` — **đã có** trong `updater.ts`, tái dùng.
- `pickDmgAsset(assets, arch)` — chọn `.dmg` theo `arm64`/`x64` (arm64→tên chứa `-arm64`; x64→chứa `-x64` hoặc không có hậu tố arch). Thuần, dễ test.

## 5. Hợp đồng IPC & data model

Commands (renderer→main, `ipcRenderer.invoke`):
- `update:check` → `UpdateStatus` (chạy check, trả snapshot; cũng phát event).
- `update:start` → `void` (bắt đầu tải; tiến độ qua event).
- `update:apply` → `void` (win: quitAndInstall; mac: mở dmg).

Event (main→renderer, `webContents.send('update:status', UpdateStatus)`):

```ts
type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
interface UpdateStatus {
  state: UpdateState;
  platform: 'win32' | 'darwin' | 'other';
  current: string;
  latest: string | null;
  percent?: number;        // khi downloading
  canAutoInstall: boolean; // win=true, mac=false
  error?: string;
}
```

Renderer (`api.ts` + `preload.ts`): thêm wrapper `update.check()/start()/apply()` và `update.onStatus(cb)` theo đúng pattern contextBridge hiện tại. `UpdateInfo` cũ (trong `types.ts`) được thay/đắp bằng `UpdateStatus`.

## 6. Luồng dữ liệu

**Windows:** khởi động → `update:check` → autoUpdater đọc `latest.yml` → nếu mới: state=`available` → user bấm "Tải" → `update:start` → `download-progress` → state=`downloading` (%) → `update-downloaded` → state=`downloaded` → user bấm "Cài & khởi động lại" → `update:apply` → `quitAndInstall()` (UAC) → cài đè → relaunch.

**macOS:** khởi động → `update:check` → GitHub API → `isNewer` → state=`available` → user bấm "Tải" → `update:start` → tải `.dmg` (onProgress) → state=`downloaded` → user bấm "Mở trình cài đặt" → `update:apply` → `shell.openPath(dmg)` → Finder kéo-thả.

## 7. Xử lý lỗi & fallback

- Mọi check/tải **không bao giờ throw lên UI**; lỗi → `state='error'` + `error` message ngắn, app vẫn chạy.
- Win: nếu `latest.yml` thiếu (release cũ) hoặc check lỗi → fallback **mở trang release** (hành vi hiện tại) làm lưới an toàn.
- Mac: nếu không tìm được asset đúng arch → fallback mở `html_url` của release.
- Mạng lỗi → thử lại ở lần "Kiểm tra cập nhật" thủ công.

## 8. Thay đổi CI (`release.yml`) — bắt buộc

Hiện job build chỉ upload `dist/*.dmg`, `dist/*.exe`. **Windows updater không có metadata để đọc.** Thêm vào glob upload-artifact:
- `dist/latest.yml` + `dist/*.blockmap` (**Windows — bắt buộc cho electron-updater**; nsis target sinh ra sẵn).
- Globs `dist/latest*.yml`, `dist/*.zip` để sẵn cho mọi nền tảng (vô hại, `if-no-files-found: ignore`).

**macOS chỉ ship `.dmg` (không có `latest-mac.yml`/`.zip`).** Lý do (quyết định khi review, lệch khỏi ý định forward-compat ban đầu): electron-builder chỉ sinh `latest-mac.yml` khi có **`zip` target** (Squirrel.Mac update từ zip, không từ dmg). Luồng free hiện tại KHÔNG cần nó — `MacUpdater` đọc release qua GitHub API rồi tải `.dmg` trực tiếp. Thêm `zip` target bây giờ chỉ tổ phình release (~2×100MB) cho một tương lai chưa chắc tới. Khi nào áp dụng ký số mac để silent-update, **lúc đó mới** thêm `zip` target + `latest-mac.yml` — đằng nào cũng phải sửa CI để thêm cert/notarize, nên không mất gì khi hoãn (YAGNI).

## 9. Chiến lược test (TDD)

Unit (Vitest, inject deps — không chạm mạng/electron thật):
- `isNewer` — đã có.
- `pickDmgAsset(assets, arch)` — chọn đúng dmg arm64 vs x64; fallback khi thiếu hậu tố; trả null khi không có dmg.
- `MacUpdater.check` — inject fetcher giả trả JSON GitHub → đúng `available`/`latest`/dmgUrl.
- `UpdateService` — inject `platform` + `UpdaterAdapter` giả + `broadcast` giả → assert: gọi đúng adapter, chuyển state đúng (checking→available→downloading→downloaded), forward % và lỗi, `canAutoInstall` đúng theo platform.
- **Không** test nội bộ `electron-updater` (đã bọc sau interface).

Verify thật (ngoài unit): xem mục 11.

## 10. Phạm vi

Trong phạm vi: Win auto-update đầy đủ; Mac auto-download + mở installer; check lúc khởi động + nút thủ công; banner có trạng thái; sửa CI publish metadata.

Ngoài phạm vi (YAGNI): ký số/notarize; mac silent install; update channels (beta/stable); delta nâng cao; polling định kỳ; rollback. (Có thể thêm sau, không làm bây giờ.)

## 11. Giới hạn đã biết & cách verify

- ⚠️ **Bản đang cài (v0.2.2) → bản updater đầu tiên vẫn phải cài tay 1 lần cuối.** Auto-update chỉ hiệu lực **giữa các bản đều đã có hệ thống mới + đã publish `latest.yml`**.
- ⚠️ **electron-updater chỉ hoạt động khi app đã đóng gói** (dev no-op). Logic được phủ bằng unit test qua DI; còn lần "chạy thật" đầu-cuối **bắt buộc cắt 1 release thử** (vd build v0.2.3 → bump v0.2.4 và xác nhận Windows tự nhảy, macOS tự tải dmg). Đây là bước thủ công cần người dùng cho phép cắt release.
- Windows chưa ký → SmartScreen/UAC còn hiện lần đầu (chấp nhận được theo quyết định mục 2).

## 12. Danh sách file thay đổi

Mới:
- `src/main/update-service.ts` — orchestrator + state + broadcast.
- `src/main/win-updater.ts` — `WinUpdater` (electron-updater adapter).
- `src/main/mac-updater.ts` — `MacUpdater` + `pickDmgAsset` + tải dmg.
- `tests/update-service.test.ts`, `tests/mac-updater.test.ts`.

Sửa:
- `src/main/index.ts` — khởi tạo `UpdateService` sau khi services ready; thay handler `app:check-update`.
- `src/main/ipc.ts` — đăng ký `update:check/start/apply` + nối broadcast (hoặc làm trong update-service).
- `src/main/types.ts` — thêm `UpdateStatus`/`UpdateState` (thay `UpdateInfo`).
- `src/main/updater.ts` — giữ `isNewer`; mở rộng/di chuyển GitHub fetch sang `mac-updater` (lấy `assets`).
- `src/preload/preload.ts`, `src/renderer/api.ts` — thêm `update.*` + `onStatus`.
- `src/renderer/components/UpdateBanner.tsx` (+ chỗ dùng trong `App.tsx`) — banner có trạng thái.
- `package.json` — thêm dep `electron-updater`.
- `.github/workflows/release.yml` — publish `latest*.yml`, `*.blockmap`, `*.zip`.

Phụ thuộc mới: `electron-updater` (cùng hệ electron-builder, không native module).
