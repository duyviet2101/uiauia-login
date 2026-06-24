# Windows Handoff — Anti-Detect Verification Harness

> **Read this first, then read the spec.** This file bootstraps a fresh Claude Code
> session running **on the Windows machine** so it can build + run the verification
> harness against the real CloakBrowser 57-patch binary. It carries the context a
> cold session would otherwise lack (the Mac dev session's memory does not travel).

---

## 0. Your job, in one paragraph

`uiauia-login` is a packaged desktop app (Electron + electron-vite + React + Tailwind
+ TypeScript; lowdb storage) that manages many anti-detect Chrome profiles for
**manual** use — the user drives the browser windows by hand, one per account. It is
built on the **`cloakbrowser`** npm package (patched Chromium). The single most
important property is **cross-profile unlinkability on ONE physical machine**: a
platform must not be able to tell that many Chrome windows share one Windows PC.

We are in a **"verify first, then decide"** phase, focused on **Windows only**,
optimizing for **strongest anti-detect** (not runtime throughput). Your task: build
the **verification harness** described in
[`docs/superpowers/specs/2026-06-24-windows-antidetect-verification-harness-design.md`](superpowers/specs/2026-06-24-windows-antidetect-verification-harness-design.md),
run it on this Windows box, and produce a report measuring **(1) per-profile
uniqueness** and **(2) internal consistency**. From that evidence we then decide
"harden existing" vs. "expand the fingerprint control surface" (a separate spec).

The design is **already approved** by the user. Do not re-brainstorm it. Start at the
implementation plan.

---

## 1. Repo & branch

- Repo: `uiauia-login` (this folder). Owner `duyviet2101`, public GitHub.
- Work on branch **`feat/windows-antidetect-verification`** (the spec + this handoff
  are committed there). If it is not present locally, fetch/checkout it, or create it
  from `main`.
- Commits authored as `duyviet2101 <whoisduyviet@gmail.com>`; end commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 2. Environment setup (do this before anything)

1. **Node ≥ 18 (20 LTS preferred).** Vitest/Vite will not boot on Node 16
   (`crypto.getRandomValues is not a function`). Check `node -v`.
2. **`npm ci`** — IMPORTANT. The lockfile pins `cloakbrowser@0.4.1`, but a stale
   `node_modules` may hold `0.3.31`. `npm ci` syncs you to the binary users actually
   ship. The user has chosen to stay on **cloakbrowser 0.4.1** (newest engine).
3. Confirm the engine at runtime: `binaryInfo().version` from `cloakbrowser`
   (the app already uses this in `src/main/identity-service.ts`). The first launch
   may download the Chromium binary — let it finish.
4. Sanity: `npx tsc -p tsconfig.json --noEmit` (should be clean) and
   `npm test` (vitest; ~140 tests expected to pass on Node ≥18).

---

## 3. Why Windows is the right place (engine reality)

CloakBrowser ships **different patch levels per OS**:

- **Windows / Linux = 146+ / 57 fingerprint patches.** Canvas, audio, WebGL,
  screen, cores all vary per `--fingerprint=<seed>`. This is the build where true
  per-profile uniqueness is achievable. **← you are here.**
- **macOS = 145 / 25 patches.** Canvas + audio are byte-identical across all
  profiles (the "Mac wall"). Irrelevant to your work, but it is *why* we moved to
  Windows: the Mac dev machine cannot reproduce or verify Windows fingerprint
  behavior. Trust only what you measure on this box.

---

## 4. How the app launches a profile (what the harness must reproduce)

The harness MUST measure the **real** launch config, not a synthetic one. The real
path is small and Electron-free, so you can import it directly:

- **`src/main/launch-args.ts` → `buildLaunchArgs(profile, display, fontsDir)`**
  currently emits these flags (read it; do not trust this list blindly — confirm
  against the file):
  - `--fingerprint=<seed>`
  - `--fingerprint-platform=windows`
  - `--ignore-gpu-blocklist`
  - `--fingerprint-screen-width=<W>` / `--fingerprint-screen-height=<H>` — **set to
    the REAL monitor**, deliberately (NOT varied per profile). A spoofed screen ≠
    real monitor fights the binary's window-position patch (fullscreen pops out /
    window drifts on new-tab) and trips FingerprintJS "Virtual machine"
    (screen ≠ viewport). This is an intentional trade-off — see §6.
  - `--restore-last-session`, `--start-maximized`
  - `--fingerprint-hardware-concurrency=<n>` and `--fingerprint-device-memory=<n>`
    — derived per-profile from the seed (decorrelated int-hash), frozen for
    warmed-up profiles.
  - `--fingerprint-webrtc-ip=<exitIp|auto>` (locked exit IP, or `auto`).
  - `--fingerprint-fonts-dir=<dir>` — **windows platform only**, and only when a
    bundle with **≥ 50** font files is present (`src/main/fonts-dir.ts`); else
    omitted (a sparse fake font list is worse than the OS default).
  - Context options: `viewport: null`, `stealthArgs: false`, `chromiumSandbox: true`,
    top-level `proxy: <url>` only. **Do NOT add a structured `launchOptions.proxy`** —
    it re-enables Playwright's CDP auth interceptor on top of `--proxy-server` and
    hangs every request on 0.4.x (this was the v0.3.2 bug fix; keep it removed).
- **`src/main/browser-preferences.ts` → `prepareBrowserPreferences(userDataDir, opts)`**
  seeds `Default/Preferences` BEFORE launch (verified, undetectable as JS overrides):
  - `geolocation: 2` (block geo permission — default ON, kills WiFi-location leak)
  - `enable_do_not_track` (default OFF)
  - `local_fonts: 2` — **always on**; blocks `queryLocalFonts()` so a page can never
    enumerate the real host fonts (incl. user-installed). `--fingerprint-fonts-dir`
    does NOT cover this API; confirmed `count=0` after this fix.
  - `session.restore_on_startup: 1` + a permission-free Google-search override extension.
- Real launch sequence per profile (minus identity-lock side effects):
  `prepareBrowserPreferences(...)` → `launchPersistentContext(buildLaunchArgs(profile, display, fontsDir))`.
- The harness gets `display` from a **`--screen WxH` CLI flag** (the app reads it from
  Electron `screen.getPrimaryDisplay()`, which you can't do outside Electron). **Pass
  this Windows box's actual resolution** (Settings → System → Display). Getting it
  wrong invalidates the screen/consistency results.

Other per-axis flags exist in CloakBrowser but the app does **not** pass them yet
(candidates for the later "expand" phase; verify names against the installed
version's README before using): `--fingerprint-gpu-vendor` / `-gpu-renderer`,
`--fingerprint-brand` / `-brand-version`, `--fingerprint-platform-version`,
`--fingerprint-storage-quota`, `--fingerprint-taskbar-height`, `--fingerprint-noise`,
and (0.4.x) `--fingerprint-windows-font-metrics`.

---

## 5. Build order (the harness — follow the spec)

If the **superpowers** plugin is installed here, invoke `writing-plans` then drive
implementation with `test-driven-development`. If not, follow this order directly
(it is the same intent):

1. `scripts/verify-windows/collisions.ts` — **pure** `collisions(observations[]) →
   CollisionRow[]`. **TDD this first** with fixtures (two profiles with identical
   canvas → HIGH; identical screen → CONTEXT; all-distinct → none).
2. `scripts/verify-windows/consistency.ts` — **pure** `consistency(observation) →
   RuleResult[]`. **TDD** with a clean fixture (all pass) and a broken one
   (forced `SwiftShader` renderer / Windows UA + `MacIntel` platform → fail).
3. `scripts/verify-windows/probe.ts` — extend the in-page probe from
   `src/main/fingerprint-probe.ts` to the richer vector set in the spec (add
   clientRects hash + UA-Client-Hints `getHighEntropyValues`). Thin glue; verify by
   real run.
4. `scripts/verify-windows/external.ts` — best-effort open + scrape of
   creepjs / iphey.com / pixelscan (`--external`). Never fatal on failure.
5. `scripts/verify-windows/report.ts` — write `observations.json` + `report.md`.
6. `scripts/verify-windows/cli.ts` — arg parsing, temp-dir throwaway profiles via the
   real `ProfileStore`, orchestration. Add `npm run verify:windows`.

Keep pure logic (`collisions`, `consistency`) unit-tested; the browser/DOM glue is
verified by you running it on this box.

---

## 6. Known Windows gaps to keep in mind (don't fix yet — measure them)

These come from the 2026-06-24 audit (full version:
[`docs/antidetect-multi-profile-stability-audit.md`](antidetect-multi-profile-stability-audit.md)
and `docs/TECHNICAL.md`). The harness should surface whether each is real here:

- **Resolution shared across profiles** — by design (real monitor). Low-entropy on a
  1920×1080 box, but a **distinctive panel (ultrawide / hi-DPI) becomes a strong
  shared signal**. The collision matrix will show screen as CONTEXT-shared; judge
  whether this machine's resolution is rare.
- **Fonts** — `--fingerprint-fonts-dir` is windows-only + needs the ≥50-file bundle,
  and is **unverified on the 0.4.x (146/148) binary**. Check the bundle is present
  (`build/fonts/windows` or packaged `resources/fonts/windows`) and that the font
  list looks like a plausible clean Windows set, not the host's.
- **IPv6 leak** — only *warned* today (best-effort probe). If this box is dual-stack
  with an IPv4-only proxy, the real IPv6 can leak past the proxy.
- **DNS** — unverified; likely proxied (SOCKS5 remote DNS / HTTP CONNECT) but confirm.
- **JA3 / TLS** — identical across profiles (same Chromium build). Industry-hard;
  millions of real Chrome users share it. Note it, don't chase it.

---

## 7. What "pass" looks like (success criteria)

Run: `npm run verify:windows -- --profiles 3 --screen <REAL_WxH> --external`

- **Uniqueness:** **0 HIGH collisions** across profiles — `canvas`, `audio`,
  `webglRenderer`, `fontHash`, `clientRects` all **distinct** per profile. (Screen
  shared is expected/CONTEXT.)
- **Consistency (per profile):** UA-token ↔ `navigator.platform` ↔ UA-CH platform all
  "Windows"; WebGL renderer is a plausible **Windows** GPU (not Apple / SwiftShader /
  llvmpipe / blank); `screen ≥ viewport`; `webdriver === false`; canvas + audio hashes
  are **real** (a null audio on Windows is itself a tell); cores ∈ [2,32], mem ∈ {2,4,8};
  timezone offset matches `Intl`.
- **External eyeball:** creepjs **lies = 0** and a stable trust score; iphey
  **"consistent"**; pixelscan no major red flags. Two profiles should produce
  **different** creepjs fingerprint hashes.

Report the numbers back to the user, then we spec the harden-vs-expand follow-up.

---

## 8. Pointers

- Approved design: `docs/superpowers/specs/2026-06-24-windows-antidetect-verification-harness-design.md`
- Full audit: `docs/antidetect-multi-profile-stability-audit.md`, `docs/TECHNICAL.md`
- Reference taxonomy (what a mature anti-detect browser controls): BitBrowser's 20
  fingerprint vectors — `https://doc.bitbrowser.net/llms.txt` (index; every page is
  raw markdown at `…/fingerprint/<n>.md`; the per-vector pages are generic
  definitions, the value is the 20-vector checklist).
- Core code to read before building: `src/main/launch-args.ts`,
  `browser-preferences.ts`, `fonts-dir.ts`, `fingerprint-probe.ts`,
  `unlinkability.ts`, `store.ts`, `identity-service.ts`, `types.ts`.

---

## 9. Guardrails

- Verify empirically; **do not claim a fingerprint behaves a certain way without
  running it on this binary.** Read results via return values — note that
  `console.log` output is suppressed in the CloakBrowser manager's DevTools.
- Throwaway profiles only by default (keep detector-site traces off real accounts).
- Don't re-add `launchOptions.proxy` (hang). Don't vary `--fingerprint-screen-*`
  away from the real monitor (window-position patch + VM flag).
- Keep the engine pinned to what ships; if you bump it, that's an identity-impacting
  change — call it out.

---

## 10. Follow-up (after the verification report): Fonts Harden

The verification (see `docs/windows-antidetect-verification-findings-2026-06-24.md`)
found **fonts** is the only HIGH gap: all profiles share the identical host font
list. We confirmed against the CloakBrowser README that the binary is closed and
`--fingerprint-fonts-dir` is a Linux-additive tool that does NOT vary or hide host
fonts on Windows, and that fonts are not in the per-seed noise path. The user has
**no Pro license**, so a newer binary is out of scope.

The approved follow-up is **detect + warn + cleanup**, specced in
[`docs/superpowers/specs/2026-06-24-windows-fonts-harden-design.md`](superpowers/specs/2026-06-24-windows-fonts-harden-design.md).
Do this after the verification report is in:

1. **Phase 0 (this box):** confirm `--fingerprint-noise` default + that clientRects
   varies across seeds with noise on; and **empirically capture the stock Windows
   10/11 font baseline** → `scripts/verify-windows/windows-font-baseline.json` (the
   key data artifact — do not hand-guess it).
2. **Phase 1:** `src/main/host-fonts.ts` pure `findNonStandardFonts(detected,
   baseline)` (TDD); extend the `fingerprint-probe.ts` font probe to the curated
   dictionary (baseline ∪ common non-stock families); surface `nonStandardFonts` +
   a `high` diagnostics warning naming the offenders. Note: `queryLocalFonts` is
   blocked, so the detector uses the `measureText` width-probe dictionary — it
   mirrors what a fingerprinter can actually see.
3. **Phase 2:** remove the dead fonts-dir pipeline (launch-args `fontsDir` emission,
   `fonts-dir.ts` + its test, `browser-manager` `fontsDirProvider`, `release.yml`
   `fonts` job, `electron-builder.yml` extraResources, `build/fonts/windows`). Keep
   `local_fonts: 2`. Update `TECHNICAL.md`.

Success: clean box → no warning; after installing a test font (e.g. Inter) →
diagnostics flags it by name; fonts-dir pipeline gone; `npm test` + `tsc` +
`electron-vite build` all clean. Then report back so the Mac side updates memory.
