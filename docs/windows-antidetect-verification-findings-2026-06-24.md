# Windows Anti-Detect Verification — Findings (2026-06-24)

Evidence produced by the `scripts/verify-windows/` harness
(`npm run verify:windows -- --profiles 3 --screen 2560x1440 --external`) on the
real Windows box. This is the input to the **harden-vs-expand** follow-up spec.

## Environment

| Field | Value |
| --- | --- |
| CloakBrowser binary | `146.0.7680.177.5` (Windows 146 / 58-patch build) |
| `cloakbrowser` npm | `0.4.1` (pinned; a `0.4.3` update notice was ignored — bumping is identity-impacting) |
| Host OS | Windows 10 Enterprise LTSC 2021 (10.0.19044), x64 |
| Real monitor | 2560×1440 |
| Node | v22.22.3 |
| Profiles | 3 throwaway, platform forced `windows`, no proxy |
| Fonts dir | **not applied** — `build/fonts/windows` holds only `.gitkeep`, so the ≥50-file bundle gate fails and `--fingerprint-fonts-dir` is omitted |

## 1. Per-profile uniqueness (unlinkability)

Across 3 profiles on one machine, the high-entropy device vectors are **distinct**:

| Vector | Result |
| --- | --- |
| canvas hash | ✅ distinct (e.g. `580115ff` / `b9985476` / `26b57258`) |
| audio hash | ✅ distinct (`38f9b054` / `b3abc4ff` / `557528b2`) |
| WebGL renderer | ✅ distinct, different spoofed NVIDIA GPUs per seed (RTX 3070 / 3060 / 4080 Laptop) |
| WebGL vendor | `Google Inc. (NVIDIA)` (shared string, expected) |
| **font list / fontHash** | ❌ **HIGH collision — all 3 identical (`2316a31a`)** |
| clientRects hash | ⚠️ usually distinct, but **collided 2-of-3 in one run** — only partial per-seed entropy |
| creepjs FP id (external) | ✅ distinct across all 3 — a real detector sees 3 different devices |
| screen / cores / memory / UA | CONTEXT-shared (expected; some sharing is plausible on real machines) |

### Key finding — fonts are a shared linkage vector, and `--fingerprint-fonts-dir` does NOT fix it
Every profile enumerates the **same host font list** (13 of 20 probed families
present, byte-identical `fontHash = 2316a31a`). The binary does **not** vary which
fonts are detectable per seed. Two windows are therefore linkable by font set —
the single clear uniqueness gap.

**Verified by experiment (resolves the handoff's "unverified on 0.4.x" item):**
built a 110-file real-font bundle that deliberately **omits** four host-present
probed families (Candara, Consolas, Trebuchet MS, Verdana) and pointed
`--fingerprint-fonts-dir` at it (tested from both the project path and a
space-free `C:\cloak-fonts-test` to rule out the space-in-path confound):

- `--fingerprint-fonts-dir` **is** a recognized switch in the 146/58 binary (it
  appears in the binary's switch table), so this is not a wrong-flag-name issue.
- Yet the four omitted families **stayed "available"** and `fontHash` was
  **unchanged** (`2316a31a`). The classic `measureText` width-difference probe
  still reads the real DirectWrite/host fonts regardless of the bundle.

**Conclusion:** on 0.4.1, `--fingerprint-fonts-dir` does **not** neutralize the
width-probe font surface. It also does **not** make fonts vary per profile (all
profiles would point at the same bundle anyway). Its only plausible effect is on
the Font Access API (`queryLocalFonts`), which is already blocked by
`local_fonts: 2`. So shipping the font bundle would **not** close this gap.

### Secondary finding — clientRects entropy is weak
clientRects geometry varied across profiles in some runs but **collided between 2
of 3 profiles** in another. It carries only limited per-seed entropy (likely
dominated by the shared font metrics), so it is a *probabilistic* linkage vector,
not a reliable per-profile one.

## 2. Internal consistency (plausibility)

**All 10 rules pass for all 3 profiles.** No contradiction a fingerprinter's
lie-detection would flag:

- UA token ↔ `navigator.platform` (`Win32`) ↔ UA-CH platform (`Windows`) all agree.
- WebGL renderer is a plausible Windows GPU (real ANGLE/D3D11 NVIDIA string; no
  SwiftShader / llvmpipe / Apple / software).
- screen 2560×1440 ≥ viewport; `webdriver === false`; canvas + audio hashes real.
- cores ∈ [2,32] (8/8/16), deviceMemory ∈ {2,4,8} (4/8/4) — decorrelated per seed.
- UA Chrome 146 matches UA-CH Chromium 146 full-version (`146.0.7680.177`).
- `Date.getTimezoneOffset()` (−420) matches the Intl zone (Asia/Saigon — host TZ,
  since no proxy/geoip was applied).

Note: UA-CH `platformVersion` is spoofed to `19.0.0` (Win11-like) on a Win10 host
— internally consistent (NT 10.0 covers Win10/11) and shared across profiles
(low-entropy, not a linkage).

## Probe notes (so results are reproducible)

- The probe runs on a **loopback `http://127.0.0.1` page**, which Chromium treats
  as a secure context. On `about:blank` (not secure) both `navigator.deviceMemory`
  and `navigator.userAgentData` are absent — measuring there would have falsely
  degraded the consistency checks. Still fully offline (no CDN).
- External detectors (creepjs / iphey / pixelscan) are opened per profile for human
  reading. Only the **creepjs FP id** scrapes reliably; iphey/pixelscan headline
  verdicts are reported as `n/a` rather than guessed (their SPA text is not
  scrape-stable). Read the open windows on the box for those verdicts.

## Supported `--fingerprint-*` switches in the 146/58 binary (extracted from chrome.dll)

`brand`, `brand-version`, `device-memory`, `failure`, `fonts-dir`, `gpu-renderer`,
`gpu-vendor`, `hardware-concurrency`, `locale`, `location`, `noise`, `platform`,
`platform-version`, `screen-width`, `screen-height`, `storage-quota`,
`taskbar-height`, `timezone`, `webrtc-ip`.

Notable: there is **no** per-seed font-list switch (only `fonts-dir`, shown above
to not affect the width-probe) and **no** `windows-font-metrics` switch. The app
currently does not pass `gpu-vendor/renderer`, `brand/brand-version`,
`platform-version`, `storage-quota`, `taskbar-height`, `noise`, or `location` —
candidates for the "expand" phase.

## Implications for harden-vs-expand (for the next spec, not decided here)

1. **Fonts is the top gap — and the obvious lever doesn't work.** Shipping the
   font bundle does **not** close it (`--fingerprint-fonts-dir` proven above to not
   touch the width-probe on 0.4.1). Options to investigate instead: a newer binary
   (Pro 0.4.3/148) that may sandbox DirectWrite font enumeration; an extension/CDP
   layer that intercepts font measurement; or accepting fonts as a low-entropy
   "generic Windows" vector and ensuring nothing host-distinctive (user-installed
   fonts) leaks via the width-probe.
2. **clientRects** deserves a second look — confirm whether the binary is expected
   to noise it per seed, since it currently under-varies (collided 2-of-3 once).
3. canvas / audio / WebGL / cores / memory / UA-CH all behave as intended on this
   146/58 build — no action needed there from this evidence.
