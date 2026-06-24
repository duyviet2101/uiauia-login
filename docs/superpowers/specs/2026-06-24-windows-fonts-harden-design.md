# Windows Fonts Harden — Design

Date: 2026-06-24
Status: Approved (brainstorming) — implement + verify on Windows
Predecessor: `2026-06-24-windows-antidetect-verification-harness-design.md`
Evidence: `docs/windows-antidetect-verification-findings-2026-06-24.md`

## Context

The Windows verification run proved the build is strong on the 146/58-patch binary
— canvas/audio/WebGL/cores/memory all vary per profile, creepjs sees 3 distinct
devices, all consistency rules pass — with **exactly one HIGH gap: fonts.** All
profiles enumerate the **identical host font list** (`fontHash 2316a31a`), so two
windows are linkable by font set.

Root cause (confirmed against the CloakBrowser engine README/CHANGELOG, which is a
wrapper around a **closed prebuilt binary** — no C++ patch source in-repo, so we
cannot fix it ourselves):

- `--fingerprint` claims to seed fonts, but `--fingerprint-noise` (the per-seed
  perturbation) covers only *canvas, WebGL, audio, client rects* — **not fonts**.
- `--fingerprint-fonts-dir` is a **Linux/Docker additive** tool ("Font Setup on
  Linux") to supply fonts a minimal environment lacks. On a Windows host that
  already has its fonts via DirectWrite it is a no-op — experimentally proven on
  0.4.1 (a 110-file bundle omitting 4 host fonts did not change the width-probe).
- The binary's *"font auto-hide for cross-platform fingerprints"* only hides fonts
  that don't match the spoofed OS. Windows-spoof on a Windows host has nothing
  cross-platform to hide → host fonts (incl. user-installed) leak into every profile.

The user has **no CloakBrowser Pro license**, so a newer/Pro binary that might
sandbox DirectWrite enumeration is out of scope.

## Goal

Given we cannot make fonts vary per profile (closed binary) and shouldn't try (real
machines don't vary installed fonts per window), neutralize the **real** linkage
risk: **host-distinctive (user-installed) fonts that leak identically into every
profile.** A stock Windows 10/11 font set is low-entropy and acceptable; a
user-installed font shared across all profiles is a strong shared signal.

## Non-goals

- Per-profile font uniqueness (impossible on the closed binary).
- Patching the binary / shipping a font bundle (proven ineffective on Windows).
- Pro/newer-binary evaluation (no license).
- Touching anything that already passed verification (canvas/audio/WebGL/etc.).

## Key constraint the detector must respect

`queryLocalFonts()` is **blocked** by `local_fonts: 2` (verified: returns empty).
So a fingerprinter on a target site cannot use the Font Access API against our
profiles — it is limited to the brute-force `measureText` width-probe over a
**dictionary of font names it already knows**. A truly arbitrary custom font name
(e.g. "tirra") is invisible to both the adversary and to us unless its name is in
the dictionary. Therefore the detector must **mirror the adversary**: probe a curated
dictionary and flag dictionary fonts that are present but not part of the stock
Windows baseline. We are not trying to find unknowable custom fonts — we are
detecting the ones a real fingerprinter could see.

## Design

### Phase 0 — Light spike + capture baseline (Windows)
Re-run the existing `verify-windows` harness and, in addition:
1. Confirm `--fingerprint-noise` default state and that **clientRects varies across
   seeds** when noise is on (the 2-of-3 collision was likely weak entropy, not a
   hole — noise covers clientRects per the README). Record the result; if it
   genuinely under-varies, note it as an upstream-engine observation (not fixable
   here) and move on.
2. **Empirically capture the stock Windows 10/11 font baseline** on the clean box —
   the exact set of standard families a fingerprinter's dictionary would find on a
   default install. This is the key data artifact for Phase 1; do NOT hand-guess it.
   Save as `scripts/verify-windows/windows-font-baseline.json` with a provenance note
   (OS build it came from).

### Phase 1 — Detect + warn (uiauia-login)
- `src/main/host-fonts.ts` — **pure** `findNonStandardFonts(detected: string[],
  baseline: string[]): string[]` returning detected-minus-baseline (case/space
  normalized). TDD first.
- Extend the in-page font probe (`fingerprint-probe.ts` `fontSummary`) from 20
  families to the **curated dictionary** = the captured stock baseline ∪ a list of
  common **non-stock** families a fingerprinter tests (MS Office: Bahnschrift if
  non-default, Calibri Light, etc.; Adobe: Source Sans/Code Pro; popular installs).
  The dictionary lives next to the baseline so both evolve together.
- Wire results into diagnostics: a `nonStandardFonts: string[]` field +
  a `high`-level warning when non-empty, surfaced where `runDiagnostics` results
  already show. Message names the offenders, e.g. *"3 user-installed fonts leak
  identically into every profile (SF Pro, Inter, FiraCode) — remove them from
  Windows, or use a clean machine for high-value accounts."*
- (Optional, behind the existing diagnostics flow — NOT a launch blocker.)

### Phase 2 — Remove the dead fonts-dir pipeline (uiauia-login)
The bundle gives no Windows benefit and re-introduces MS-font license risk (it
already caused the v0.3.0 loose-asset leak). Remove:
- `--fingerprint-fonts-dir` emission in `launch-args.ts` (the `fontsDir` param +
  the windows-only push); drop the `fontsDirProvider` wiring in `browser-manager.ts`.
- `src/main/fonts-dir.ts` + `tests/fonts-dir.test.ts`.
- `release.yml` `fonts` job and the matrix `needs: fonts` / download-artifact steps.
- `electron-builder.yml` `extraResources` fonts entry; `build/fonts/windows`.
- **Keep** `local_fonts: 2` (queryLocalFonts block) — that one works and matters.
Update `TECHNICAL.md` (§ fonts) to state the corrected reality.

### Phase 3 — clientRects
Resolved by Phase 0's measurement. If it varies with noise on → close. If not →
record as an upstream observation; no consumer-side fix exists.

## Module boundaries

- `host-fonts.ts` — pure set-difference (unit-tested).
- `fingerprint-probe.ts` — probe extended to the dictionary (glue, Windows-verified).
- `windows-font-baseline.json` / dictionary — data, captured empirically.
- Diagnostics surfacing — small additive change to the existing diagnostics path.

## Success criteria

- On a **clean** Windows box: `findNonStandardFonts` returns `[]` → no warning.
- After installing a test font (e.g. Inter): diagnostics flags it by name, `high`.
- The fonts-dir pipeline is gone; `npm test` + `tsc` clean; `electron-vite build` OK;
  release produces the same clean asset set (no font artifacts).
- Verification harness re-run: fonts still the only collision, now *explained +
  surfaced to the user* rather than silently shared.

## Out of scope / future

- An in-app "scrub host fonts" action (uninstalling Windows fonts) — intrusive; the
  operating guidance is "run high-value accounts on a clean font set."
- Revisit per-seed font variation only if the user later obtains a binary that
  sandboxes DirectWrite enumeration.
