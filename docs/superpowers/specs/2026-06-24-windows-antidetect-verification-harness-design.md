# Windows Anti-Detect Verification Harness — Design

Date: 2026-06-24
Status: Approved (brainstorming) — pending spec review

## Context

Primary goal of `uiauia-login`: run many anti-detect Chrome profiles for different
accounts on **one physical machine** such that platforms cannot tell the profiles
share hardware. The audit (2026-06-24, vs BitBrowser's 20 fingerprint vectors)
concluded the architecture is sound on **Windows/Linux** (the 57-patch CloakBrowser
binary varies canvas/audio/WebGL per seed) but structurally capped on **macOS**
(25-patch binary → canvas/audio byte-identical across profiles).

Decision: **focus on Windows first**, optimizing for **strongest anti-detect**
(not runtime throughput). Before committing to "harden existing" vs. "expand the
fingerprint control surface", we **verify first** — measure where the current
Windows build actually stands, then choose the next step from evidence.

This document specifies that verification harness. It is one self-contained
sub-project; harden/expand work will be specced separately based on its output.

## Goal

Produce hard, repeatable data answering two questions for the real Windows build:

1. **Per-profile uniqueness (unlinkability):** across N profiles on the same box,
   is any fingerprint vector byte-identical between two profiles? (Identical
   canvas / audio / WebGL renderer / font list / clientRects = linkage.)
2. **Internal consistency (plausibility):** does each profile look like *one*
   coherent real Windows PC, with no detectable contradictions a fingerprinter's
   lie-detection would flag?

## Constraints (hard requirements)

- **Measure the real launch config.** The harness MUST drive the app's actual
  `buildLaunchArgs`, `prepareBrowserPreferences`, and `resolveWindowsFontsDir`,
  not a synthetic launch, or it verifies the wrong thing.
- **Runs on the real Windows PC** against the real CloakBrowser 57-patch binary.
  Findings from the Mac dev machine do not transfer.
- **No side effects on real accounts.** Detector-site history/cache must never
  land in a warmed-up profile.
- **Pure analysis logic is unit-tested (TDD);** brittle browser/DOM glue is
  verified manually on the box — matching the project's existing test style.

## Non-goals

- Not fixing any gap yet (that is the follow-up harden/expand sub-project).
- Not a shipping UI feature. It is a measurement tool under `scripts/`.
- Not macOS verification (out of scope this round).
- Not a runtime-performance/throughput benchmark.

## Design

### A. Location & invocation

- Lives in `scripts/verify-windows/` as a plain Node/tsx tool (NOT Electron).
- Run on Windows: `npm run verify:windows -- --profiles 3 --screen 1920x1080 --external`
- Imports the app's launch code from `src/main/` (`buildLaunchArgs`,
  `prepareBrowserPreferences`, `resolveWindowsFontsDir`, `ProfileStore`,
  `toProxyUrl`, types). These modules are Electron-free, so they import cleanly
  outside the app.
- The real monitor resolution is supplied via `--screen WxH` (default
  `1920x1080`). It MUST match the actual monitor — the app's `displayProvider`
  reads it from Electron `screen.getPrimaryDisplay()`; the harness cannot, so it
  takes it as input and passes it to `buildLaunchArgs(profile, display, fontsDir)`
  exactly as the app would.

### B. Profile source

- Creates **throwaway profiles in a temp data dir** via the real
  `ProfileStore.create()` (not the user's real `cloak.json`), so detector-site
  traces never touch real accounts.
- Default `--profiles 3`. Platform forced to `windows` for every profile.
- Optional `--proxies <file>` assigns one proxy per profile (one per line, parsed
  via the app's `proxy-parse`). Uniqueness measurement does not require proxies
  (IP is trivially per-proxy via separate exit); proxies mainly help the
  consistency dimension (timezone/geo realism). Default: no proxy.

### C. Probe (per profile, offline, no CDN)

Extends the existing in-page probes in `fingerprint-probe.ts` into one richer
`ProfileObservation`. Captured vectors:

- canvas hash + winding, audio hash, font list + hash (existing diagnostics)
- WebGL **vendor + renderer + selected getParameter values**
- **clientRects hash** (a common high-entropy vector not yet probed)
- UA + **UA-Client-Hints** via `navigator.userAgentData.getHighEntropyValues`
  (platform, platformVersion, architecture, brands, fullVersionList)
- `navigator.platform`, `languages`, `webdriver`, `maxTouchPoints`
- `Intl` timezone + `Date.getTimezoneOffset()` (cross-check)
- screen width/height/avail/colorDepth/pixelDepth, `devicePixelRatio`
- hardwareConcurrency, deviceMemory

Launch sequence per profile (the real path, minus identity-lock side effects):
`prepareBrowserPreferences(userDataDir, {blockGeolocation, doNotTrack})` →
`launchPersistentContext(buildLaunchArgs(profile, display, fontsDir))` →
read first page → run probe.

### D. Analyses (pure functions → TDD'd with fixtures)

1. **Collision matrix** — `collisions(observations[]) → CollisionRow[]`. For each
   tracked vector, group profiles by identical value; any group of size > 1 is a
   collision. Severity:
   - **HIGH** if shared: canvas, audio, webglRenderer, fontHash, clientRects.
   - **CONTEXT** if shared: screen, cores, memory, UA — some sharing is plausible
     on real machines; reported but not auto-failed.
2. **Consistency rules** — `consistency(observation) → RuleResult[]`, each
   predicate returns pass / warn / fail + message. Initial rule set:
   - UA platform token ↔ `navigator.platform` family ↔ UA-CH platform all "Windows".
   - WebGL renderer is a plausible Windows GPU (not Apple / SwiftShader / llvmpipe / blank).
   - `screen.width ≥ innerWidth` and `screen.height ≥ innerHeight` (screen ≥ viewport).
   - `navigator.webdriver === false`.
   - canvas hash is a real value (not `no-canvas` / `canvas-error`).
   - audio hash is non-null (a null audio on Windows is itself a tell).
   - hardwareConcurrency ∈ [2, 32]; deviceMemory ∈ {2, 4, 8}.
   - UA-CH brands include a Chromium brand whose version matches the UA version.
   - `Date.getTimezoneOffset()` consistent with the `Intl` timezone.

### E. External detector panel (best-effort, `--external`)

Opens **creepjs** (`abrahamjuliot.github.io/creepjs`), **iphey.com**, and
**pixelscan.net** in each profile window for human reading on the real box, and
scrapes the easy headline numbers where the DOM allows (creepjs lies-count + FP
hash; iphey "consistent" verdict). Any scrape failure is recorded as
`unavailable` and never aborts the run. Runs only with `--external` so the
default run stays fully offline.

### F. Output

`scripts/verify-windows/reports/<timestamp>/`:
- `observations.json` — raw per-profile observations + analysis results.
- `report.md` — run metadata (CloakBrowser binary version, host OS, #profiles,
  proxy y/n, screen), the collision-matrix table, per-profile consistency
  checklist, external verdicts, and a top-line verdict, e.g.
  *"0 HIGH collisions across 3 profiles; 1 consistency failure: WebGL renderer = SwiftShader."*

### G. Error handling

- A profile that fails to launch records an error observation; the run continues.
- External scraping is best-effort; failures are logged, not fatal.
- Only invalid CLI arguments abort the whole run.

## Module boundaries

- `cli.ts` — arg parsing, orchestration, temp-dir lifecycle.
- `probe.ts` — in-page probe → `ProfileObservation` (extends fingerprint-probe).
- `collisions.ts` — pure `collisions(observations) → CollisionRow[]`.
- `consistency.ts` — pure `consistency(observation) → RuleResult[]`.
- `external.ts` — best-effort detector-site open + scrape.
- `report.ts` — render `observations.json` + `report.md`.

Pure modules (`collisions.ts`, `consistency.ts`) are unit-tested. `probe.ts`,
`external.ts`, `cli.ts` are thin glue verified by a real Windows run.

## Success criteria

- One command on the Windows PC produces a timestamped report.
- The collision matrix correctly flags any vector shared across ≥2 profiles.
- The consistency rules correctly flag a deliberately-broken profile (e.g. a
  forced SwiftShader renderer) and pass a clean one — proven by unit fixtures.
- Output is concrete enough to decide harden-vs-expand from evidence.

## Open follow-ups (out of scope here)

- Harden vs. expand decision + its own spec, driven by this report.
- Whether any harness piece graduates into an in-app "Compare profiles" feature.
