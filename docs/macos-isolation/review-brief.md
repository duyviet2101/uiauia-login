# Review brief — macOS isolation work (2026-09-09 → 2026-09-11)

Written for a reviewer who did not watch the work happen. It states what was
claimed, what backs each claim, and where the claims stop. The point is to make
the work **easy to attack**, so read the "How to attack this" section first if
you are short on time.

Branch `macos-isolation`, 6 commits on top of `9de6c8f`. Nothing pushed.

**Round 2:** an independent review found three defects; all three were valid and are
fixed. See §0 before anything else.

---

## 0. Round-2 review outcome

Three defects were reported. **All three were confirmed in code and fixed** — none was
a misreading. Two shared one root cause: *a detector was built and then not wired into
the decision it was built for.*

| # | Defect | Verdict | Fix |
|---|---|---|---|
| P1 | `forceLaunch` passed `force: true`, and preflight skipped the whole identity check including the engine. "Mở & cập nhật IP" opened the profile on a NEW engine while the record and the toast said the engine was untouched. Keeping the old number in the store does not keep the old binary on disk. | **Valid.** The old test only asserted the stored number, so it permitted this. | Engine gate is now step 0 of preflight and runs for EVERY launch, `force` included. Accepting the engine rewrites the record *before* preflight runs, so an accepted engine arrives already matching. |
| P1 | `readEngineInfo()` detected mismatches but only logged and drew a banner; launch, locking and drift comparison still used `binaryInfo().version`. A custom binary path stayed invisible. | **Valid**, and it broke the plan's own "package version ≠ binary thực chạy" rule. | Identity comparison now uses what the binary reports; definite problems block launch before Chromium exists; `unreadable` does not block a launch but does block LOCKING a new identity; locked profiles launch pinned to the verified marker. |
| P2 | `sharedBy` filtered on `acrossOpenDistinct` but ignored `inSessionDistinct`. Since `perOpen` keeps only each open's FIRST value, a profile cycling A,B,A looks perfectly stable, so two noisy profiles were reported as fully shared while `inSessionStable: false` sat in the same row. | **Valid.** It also contradicts the function's own comment. | Noisy profiles are excluded and the reason recorded in `excludedFromSharing`; `fullyShared` stays silent whenever anything was excluded. |

Two things worth stating plainly about P2:

- It does **not** invalidate the macOS results. All three groups measured
  `inSessionStable: true`, so no row ever took the faulty path. The reviewer said
  the same, and re-checking confirms it.
- The regression test was **verified to fail on the old code** with exactly the
  reported symptom (`sharedBy` with one entry) before the fix was kept.

One thing found while fixing P1#2, which the review did not raise: the engine pin must
come from the marker just verified, **not** from `resolvedIdentity.cloakBrowserVersion`.
Two markers can share a Chromium version and differ in CloakBrowser's patch revision,
and pinning an uninstalled revision makes the launcher attempt a download — measured,
not reasoned: an unsatisfiable pin produced `HTTP 404` and, correctly, no silent
fallback.

Still outstanding from the review, and agreed: the reviewer has **not** re-run the
browser matrix, so "three shared fields, zero drift" has no independent confirmation
yet. That remains the single biggest unverified claim in this work.

## 1. What the task was

The user ran this app on Windows for two months without trouble, moved back to
macOS, and asked whether macOS could be made better. A plan was written, revised
on request, then executed.

### Constraints in force the whole time

> Không dùng hoặc sửa profile thật · Không tự nâng binary trước benchmark ·
> Không mua license, lấy key hoặc đăng nhập thay tôi · Không triển khai gateway
> proxy, kill switch, firewall, VM, remote browser hay chức năng nhân bản ·
> Không thêm JavaScript noise để làm hash khác · Không push, tag hoặc release ·
> Không tự chấp nhận baseline/engine mới cho profile đang sử dụng · Giữ nguyên
> thay đổi có sẵn không thuộc nhiệm vụ.

**All were honoured.** The one place they bind hard on a conclusion: the
launcher banner advertises a free v151 behind `cloakbrowser login`, and whether
a free key yields a macOS build is therefore **untested** (§5).

### Epistemic rules the user imposed

> Đừng đánh đồng: Hash trùng với chắc chắn cùng thiết bị · Hash khác với chắc
> chắn không thể liên kết · Probe lỗi với collision · Package version với binary
> thực chạy · Sửa cấu hình nhận diện Mac với giả lập hoàn chỉnh một model Mac.
>
> Không báo "đã kiểm chứng" nếu mới đọc code hoặc chưa chạy trên nền tảng tương
> ứng. Nếu dữ liệu bác bỏ một giả định trong plan, sửa hướng triển khai theo
> bằng chứng.

These are the right things to grade against. Section 6 lists every place a
draft violated one of them and how it was caught.

---

## 2. Commits

| Commit | Contents | tsc | tests |
|---|---|---|---|
| `e4f21c9` | verify harness rewrite (Measured<T>, SHA-256, dual canvas paths, per-persona fonts, stability triad, 2 new consistency rules, CLI flags, reanalyze) | clean | 176 pass |
| *(round 2)* | engine gate in preflight, verified-binary comparison, engine pin, stability sharing fix | clean | 235 pass |
| `6b8b0be` | five main-process workstreams (see below) | clean | 225 pass |
| `cd535ef` | session-restore probe + display probe | clean | 225 pass |
| `37d862b` | docs | — | — |

Each was checked out into a scratch worktree and verified independently — the
table is measured, not asserted.

`6b8b0be` is large on purpose. Five workstreams touch the same seven files
(`types.ts`, `store.ts`, `browser-manager.ts`, `ipc.ts`, `preload.ts`,
`api.ts`, `App.tsx`); splitting further produces commits that do not typecheck,
which is worse for bisect than one commit with a long message. **This is a
legitimate thing to push back on.**

---

## 3. Claims, and what backs each

Strength column: **measured** = ran on this hardware · **derived** = follows
from measured data · **read** = code reading only, no execution.

| # | Claim | Evidence | Strength |
|---|---|---|---|
| C1 | On macOS the canvas patch covers `getImageData`/`measureText` but NOT the export path; `toDataURL`/`toBlob` are byte-identical across seeds | dedicated experiment, 3 seeds × {png, jpeg, webp, toBlob, getImageData ×2, measureText}, call order shuffled | measured |
| C2 | Exactly three fields are genuinely shared between profiles on this Mac: `canvas.text.export`, `canvas.geometry.export`, `audio` | 132 valid observations, 3 profiles × 5 reopens × 3 measures, groups A and C | measured |
| C3 | The cause is the engine, not this app's overrides | groups A (app config) and C (engine defaults + pinned seed) collide on the same three axes | derived — see caveat C3′ |
| C4 | Zero drift: every field stable in-session and across 5 reopens, all three groups | same 132 observations | measured |
| C5 | A Windows persona on a Mac host is measurably worse: 4 shared fields and 3/3 profiles fail both new consistency rules | group B vs group A | measured |
| C6 | CloakBrowser emits **zero** ICE candidates on macOS; stock Chrome emits one mDNS candidate. The `fingerprint-webrtc-ip` flag does not exist in the macOS binary | 4 CloakBrowser configs + stock Chrome control; `strings` on the binary | measured |
| C7 | A restored tab's request arrives **49 ms before** `launchPersistentContext` returns | `session-restore-probe.ts`, local HTTP server | measured |
| C8 | Fullscreen does not change the viewport — and stock Chrome does the same | `display-probe.ts` with its built-in control | measured |
| C9 | No public macOS build newer than `145.0.7632.109.2` exists | GitHub Releases API over 30 tags + HEAD probes on the CDN | measured |
| C10 | `binaryInfo().version` (marker) matches the binary's own `--version` on this machine | `engine-info.ts` run against the real install | measured |
| C11 | The v2→v8 migration preserves seed and persona on the user's real data | migration run on a **copy** of the real store; original re-read afterwards, still `version: 2` | measured |

### C3′ — the weakest link, stated plainly

C3 says "engine, not app config" because A and C collide identically. That is
solid for the flags this app sets. It does **not** establish a mechanism inside
the C++, and no claim about the patch source is made anywhere. The
plan's ablation phase (G3.5) was skipped for exactly this reason — the decision
tree says ablation is only needed when A ≠ C — and `--drop-arg`/`--extra-arg`
are already wired if a reviewer wants it run anyway.

### Open question no single machine can answer

Is the shared canvas export hash unique to this Mac, or common to every Apple
Silicon machine on CloakBrowser 145? The first means "these three profiles look
like one device"; the second means "they look like every CloakBrowser Mac user",
which is a very different exposure. **Needs a second Mac.** Nothing in the docs
assumes either answer.

---

## 4. Behaviour changes a reviewer should scrutinise

| Change | Old behaviour | Risk if the new behaviour is wrong |
|---|---|---|
| New profiles on macOS default to `macos` persona | always `windows` | existing profiles untouched (`platform` ∈ LOCKED_IDENTITY_FIELDS); worst case is a poor default for new profiles |
| "Mở & cập nhật IP" no longer accepts a new engine | it did, silently | user must now click a second, explicit action after an engine upgrade |
| Launch blocked when a profile with a session has an unverified proxy | opened anyway | **a user with a flaky proxy cannot open a profile at all.** Deliberate — the tabs replay before any code can intervene — but it is a real usability cost, and there is no override |
| Proxy snapshot TTL 10min → 90s | — | more proxy tests, each spawning a throwaway browser (~seconds) |
| Fingerprint read on **every** launch | first launch only | one extra in-page probe per launch; no network |
| `ipv6-leak` → `ipv6-present` (low) | high-ish warning on any IPv6 | if a genuine IPv6 leak exists on a single profile it is now shown as low-level context. Accepted: the data cannot distinguish it from the proxy's own IPv6 |
| SCHEMA_VERSION 7 → 8 | — | migration is one-way; a downgrade to an older app build would see `baseline` and no `fingerprint` |

That last row is the one I would attack first: **there is no downgrade path.**

---

## 5. What is explicitly NOT verified

Nothing below is claimed anywhere in the docs. Listed so a reviewer can check
that no claim leaked in.

- **Anything through a real proxy.** Exit IP behaviour, WebRTC srflx via STUN,
  timezone alignment. No test proxy was available and none was taken from a real
  profile.
- **Windows regression.** Group B ran a Windows persona on a Mac host, which is
  not Windows. `npm run verify:windows` on a real Windows box is still owed.
- **Whether a free CloakBrowser key yields a macOS 151 build.** Constraint
  forbids logging in.
- **Hand-driven fullscreen / resize / maximize.** Everything measured ran under
  automation, which demonstrably changes fullscreen behaviour (C8).
- **External monitor, monitor switching, sleep/wake.** Hardware actions; the
  plan explicitly forbids putting the machine to sleep automatically.
- **Background traffic during session restore** (service workers, browser's own
  requests). The probe only sees requests to its own endpoint. Seeing everything
  needs a gateway, which is out of scope.
- **"No byte leaves before the check."** Never claimed. The guarantee is
  narrower and stated as such: preflight throwing means
  `launchPersistentContext` is never called, so no Chromium process exists to
  restore anything.

---

## 6. Errors made and how they were caught

Included because a reviewer should weigh how failures surfaced, not just the
final state.

1. **Canvas measured on one path only.** The first stability field used only
   `pixelDigest` (getImageData) and reported "canvas 3/3 distinct" — hiding the
   real linkage. Caught by running a dedicated dual-path experiment. Fix: split
   `canvas.*.export` from `canvas.*.imagedata`.
2. **"font.availability 3/3 distinct" was an artifact** of measureText noise.
   Caught by measuring actual set overlap: 54/57 shared. Fix: report the overlap
   so the digest cannot be misread again.
3. **A test was nearly weakened to pass.** A report test failed because an old
   fixture had only legacy flat fields. Fix was a `digestOrLegacy()` fallback in
   the analyser, not a lowered expectation.
4. **`check-failed` was inferred, not observed.** Running the migration against
   a copy of the user's **real** store showed the profile reported `check-failed`
   when nothing had failed — absence of an observation cannot distinguish "never
   looked" from "looked and got nothing". Fix: `lastObservationError`, recorded.
   This is the plan's own "probe lỗi ≠ collision" rule at a different layer.
5. **A migration stamped a guess as a record.** `schemaVersion: 7` was hardcoded;
   the real store was at v2. Fix: read the actual prior version.
6. **A check asserted "as real Chrome does" without checking real Chrome.**
   Real Chrome behaves identically under automation. Fix: the probe now runs its
   own stock-Chrome control and only fails on a genuine difference.

Items 4, 5 and 6 were found in the last two hours of work, by running things
against real data and real controls rather than by reasoning. Item 6 in
particular would have shipped a false attribution to the CloakBrowser binary.

---

## 7. How to attack this

Highest value first:

1. **Re-run the matrix** and see if C2/C4 reproduce:
   ```bash
   npm run verify:mac -- --group A --profiles 3 --opens 5 --repeats 3
   ```
2. **Check the preflight ordering test is real.** `tests/browser-manager.test.ts`
   asserts the ORDER `['proxy-test', 'launch']`, not merely that a test ran. If
   you can make the gate pass while the launcher still fires first, the gate is
   fake.
3. **Attack the usability cost of the hard blocks.** A profile with a session and
   an intermittent proxy is now unopenable, and a profile whose engine changed
   cannot be opened at all until the user accepts the engine. Both are
   deliberate. Both are real friction. Is refusing right, or should there be a
   "clear the session, then open" path?
3b. **Attack the `unreadable` carve-out.** A binary that will not answer
   `--version` still launches; only locking is refused. If you think an
   unverifiable engine should block every launch, that is a defensible position
   and the opposite of what is implemented.
4. **Attack the single big commit** (`6b8b0be`). If you can find a green split,
   the argument for keeping it whole fails.
5. **Attack C3.** Run the ablation the plan allows for (`--drop-arg`), and see
   whether any flag group moves the three shared axes.
6. **Attack the `low` severity choice.** Downgrading `same-asn-geo` and
   `ipv6-present` is a judgement about evidence, not a measurement. If you think
   a user is better served by a louder signal, that is a real argument.
7. **Check nothing touched a real profile.** `git log -p` for any path under the
   user's `Application Support`; the only access was one file **copy**, and the
   original was re-read afterwards to confirm it was unchanged.

## 8. Where things live

| What | Where |
|---|---|
| Plan + live status table | `docs/macos-isolation/implementation-plan.md` §0.5 |
| Findings and evidence | `docs/macos-isolation/findings.md` |
| How to reproduce everything | `docs/macos-isolation/verification.md` |
| Architecture as it now stands | `docs/TECHNICAL.md` §5.1, §5.2, §6.1, §6.2, §9.1, §9.1b–d |
| Preflight gate | `src/main/browser-manager.ts` — `preflight()` |
| Health model | `src/main/profile-health.ts` |
| Engine verification | `src/main/engine-info.ts` |
| Probes | `scripts/verify-windows/{session-restore,display}-probe.ts` |

Artifacts from the measurement runs are under
`scripts/verify-windows/reports/`, which is gitignored — they are local-only and
not part of these commits.
