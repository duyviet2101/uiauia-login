# CloakBrowser Manager (uiauia-login)

Ứng dụng desktop (Windows `.exe` / macOS `.dmg`) quản lý **nhiều profile Chrome anti-detect** để thao tác thủ công — mỗi profile có fingerprint, proxy, timezone/locale và phiên đăng nhập riêng. Mục tiêu số 1: **các nền tảng không nhận ra nhiều cửa sổ Chrome cùng xuất phát từ một máy nguồn** (cross-instance unlinkability).

> Xây trên engine [`cloakbrowser`](https://www.npmjs.com/package/cloakbrowser) — bản Chromium stealth được vá ở tầng C++ (58 patch: canvas, WebGL, audio, fonts, GPU, screen, WebRTC, automation signals).

Tài liệu kỹ thuật đầy đủ (kiến trúc, cơ chế, **hạn chế**): [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

---

## Bài toán

Khi quản lý nhiều tài khoản trên cùng một nền tảng (marketplace, mạng xã hội…), việc mở nhiều phiên từ một máy dễ bị phát hiện và liên kết qua: cùng IP, WebRTC leak, fingerprint phần cứng trùng, cookie/storage dùng chung, timezone/locale lệch với IP… Các tool tự host hoặc trình duyệt thường không cô lập triệt để các trục này.

## Giải pháp

Mỗi profile là một danh tính độc lập:

| Trục | Cách xử lý |
|------|-----------|
| IP | Proxy riêng từng profile (HTTP/SOCKS5); cảnh báo khi không proxy hoặc trùng IP |
| WebRTC leak | `--fingerprint-webrtc-ip` khớp IP exit của proxy |
| Fingerprint (canvas/WebGL/audio/GPU) | `--fingerprint=<seed>` cố định, ngẫu nhiên mỗi profile |
| Hệ điều hành giả lập | `--fingerprint-platform=windows\|macos` mỗi profile |
| Timezone / locale | geoip tự khớp theo IP proxy, hoặc override tay |
| Cookie / storage | `userDataDir` riêng từng profile (phiên bền) |
| Trôi danh tính | **Identity lock + drift detection** — khoá IP/seed/version sau lần mở đầu, chặn mở nếu môi trường đổi |

Cửa sổ Chrome **thật** hiện trên desktop để thao tác tay (không phải automation/headless).

---

## Cài đặt (người dùng cuối)

Tải installer từ [Releases](https://github.com/duyviet2101/uiauia-login/releases):

- **Windows:** `CloakBrowser Manager Setup x.y.z.exe` → cài. Chưa code-sign nên SmartScreen có thể chặn → **More info → Run anyway**.
- **macOS Apple Silicon:** `...-arm64.dmg` · **macOS Intel:** `...-.dmg`. Chưa notarize → lần đầu **chuột phải vào app → Open**, hoặc `xattr -cr "/Applications/CloakBrowser Manager.app"`.

Lần chạy đầu app tự tải Chromium stealth (~150 MB) về `~/.cloakbrowser`. Dữ liệu profile lưu tại thư mục userData của hệ điều hành và **được giữ nguyên qua các bản cập nhật**.

---

## Sử dụng

1. **+ Tạo profile** → đặt tên, chọn OS giả lập, dán proxy (`host:port:user:pass` tự tách), bật geoip / override timezone-locale nếu cần.
2. **Test proxy** để kiểm IP exit trước khi mở.
3. **Mở** → cửa sổ Chrome riêng hiện ra, đăng nhập/thao tác bình thường. Lần mở đầu app đo fingerprint local (navigator/screen/WebGL) để khóa identity.
4. **Diagnostics** chạy probe local cho canvas/audio/font; **Test FP ↗** mở trang kiểm tra fingerprint bên ngoài khi cần.
5. **Xem fingerprint** để đối chiếu giữa các profile; **Đổi seed** nếu muốn danh tính mới.

> ⚠️ Để unlinkability tốt nhất nên chạy trên **Windows** — xem mục hạn chế canvas trên macOS trong tài liệu kỹ thuật.

---

## Phát triển

```bash
npm install
npm run dev      # chạy app dev (electron-vite)
npm test         # unit tests (vitest)
npm run build    # build production bundle
npm run dist:mac # đóng gói .dmg (macOS)
npm run dist:win # đóng gói .exe (nên build trên Windows thật — xem CI)
```

**Stack:** Electron · electron-vite · React + Tailwind v4 · TypeScript · lowdb (JSON) · Vitest · electron-builder.

**Kiến trúc:** main process giữ toàn bộ logic; renderer cô lập (`contextIsolation`, không `nodeIntegration`); giao tiếp qua IPC preload. Chi tiết: [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

---

## Phát hành

CI (GitHub Actions) tự build `.dmg` + `.exe` trên runner macOS + Windows thật rồi publish 1 release khi push tag:

```bash
# sửa "version" trong package.json
git commit -am "chore: bump vX.Y.Z" && git push
git tag vX.Y.Z && git push origin vX.Y.Z
```

App tự kiểm tra bản mới (so với GitHub Release mới nhất) và hiện banner cập nhật khi khởi động.

---

## Hạn chế (tóm tắt — đọc kỹ trong tài liệu kỹ thuật)

- **macOS: canvas-2D không đa dạng hoá theo seed** (giới hạn binary cloakbrowser) → các profile dùng chung canvas hash. Fingerprint tổng hợp (FingerprintJS visitorId) vẫn khác nhau, nhưng tracker chuyên soi canvas có thể liên kết. **Khuyến nghị vận hành trên Windows.**
- `hardwareConcurrency`, `deviceMemory`, độ phân giải màn hình **không** biến thiên theo seed (không có flag) — nhưng là giá trị phổ biến nên ít nổi bật.
- Font enumeration qua JS vẫn phản ánh font OS thật.
- App **chưa code-sign / notarize** → cảnh báo Gatekeeper / SmartScreen.
- Ngoài phạm vi: danh tính thanh toán/tax, nội dung upload, kho proxy/rotation — những thứ này quyết định lớn với marketplace (vd Redbubble) nhưng nằm ngoài tầm của trình duyệt.

---

## License

ISC. Dùng cho mục đích quản lý tài khoản hợp lệ của chính bạn.
