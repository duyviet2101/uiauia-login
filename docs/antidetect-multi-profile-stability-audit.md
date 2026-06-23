# Anti-Detect Multi-Profile Stability Audit

Primary priority: preserve a stable browser identity for each profile after proxy setup, so many profiles can run on the same physical machine without a platform seeing one account as a user who keeps changing device fingerprint. Automation is not the main goal.

## Executive Summary

`uiauia-login` is directionally correct: every profile has its own seed, user data directory, persistent browser context, optional proxy, and launches through CloakBrowser patched Chromium. That gives each profile a distinct baseline identity.

However, it does not yet fully guarantee long-term identity stability for multi-profile use. The effective fingerprint is still derived at launch time from seed + browser binary + proxy/GeoIP state. If the proxy exit IP changes, GeoIP resolves differently, CloakBrowser auto-updates its binary, or the user edits identity-impacting settings, the platform may observe the same profile as a changed device or changed environment.

The main fix is to add an `identityLocked` mode: resolve and store the actual identity applied during the first setup, then launch future sessions from that frozen identity and warn or block when anything drifts.

## Update — 2026-06-23: Fingerprint hardening shipped

Branch `feat/fingerprint-hardening` đã xử lý nhóm Geo / DNT / IPv6 / Fonts trong các gaps bên dưới (TDD; chi tiết: `docs/superpowers/plans/2026-06-22-fingerprint-hardening.md`, `docs/TECHNICAL.md` mục 4.2 + 9.7):

- ✅ **Geo permission** — `blockGeolocation` (mặc định ON) ghi `geolocation:2` vào Chrome Preferences trước mỗi launch → vị trí bị denied. Match-city bị loại (`--fingerprint-location` hỏng trên binary Mac).
- ✅ **Do Not Track** — `doNotTrack` (mặc định OFF) qua `enable_do_not_track`.
- ✅ **Fonts** — `--fingerprint-fonts-dir` sandbox font host trên profile windows-spoof (bundle font Windows nạp từ CI runner, không commit vào repo). Giấu cả font user cài thêm.
- ⚠️ **IPv6 leak** — cảnh báo best-effort (probe `api6.ipify.org` qua proxy) → warning `medium` trong `unlinkability.ts`.
- ❌ **DNS true leak-test** — vẫn **ngoài phạm vi** (cần API/callback ngoài log resolver IP).

## Design Principles

1. A profile must behave like a stable virtual device, not a freshly randomized browser every time it opens.
2. Randomization should happen only when creating a new profile or when the user explicitly resets identity.
3. Once a profile has logged in or warmed up on a platform, proxy, timezone, locale, WebRTC IP, browser version, user agent, screen, GPU, CPU, and memory should be frozen.
4. Every identity-impacting change must show a clear warning before launch.
5. The app should verify the real fingerprint after launch and compare it against the stored snapshot, rather than trusting config alone.

## Current State

### What Is Already Good

- Each profile gets a fixed seed on creation:
  - `src/main/store.ts:57` creates `seed: this.seedGen()`.
  - `src/main/launch-args.ts:13` launches with `--fingerprint=${p.seed}`.
- Each profile has its own user data directory:
  - `src/main/store.ts:52` creates `userDataDir = join(this.dataDir, 'profiles', id)`.
  - `src/main/launch-args.ts:25` passes `userDataDir` to `launchPersistentContext`.
- The app uses persistent contexts, which avoids incognito-session penalties:
  - `src/main/browser-manager.ts:34` calls `launchPersistentContext(buildLaunchArgs(profile))`.
- The implementation relies on CloakBrowser binary-level spoofing instead of hand-written JavaScript patches:
  - `CloakBrowser/js/src/playwright.ts:233-241` applies timezone and locale through binary flags and context options.
- There is a basic anti-detect integration test proving that two different seeds produce different WebGL renderers and FingerprintJS visitor IDs:
  - `tests/integration/anti-detect.test.ts:64-70`.

### Main Gaps

- The profile model is too thin:
  - `src/main/types.ts:26-40` stores only seed, platform, proxy, GeoIP, timezone, locale, start URL, and fingerprint snapshot.
  - It does not store browser version, resolved proxy identity, screen/window size, GPU, CPU, RAM, user agent, WebRTC policy, geolocation permission, color scheme, fonts, media devices, audio, or canvas policy.
- Proxy testing only checks HTTP exit IP through `api.ipify.org`:
  - `src/main/proxy-tester.ts:16-23`.
  - It does not check WebRTC leaks, timezone/locale consistency, ASN/ISP, DNS leaks, or actual exit IP collision.
- Proxy conflict detection only groups by `host:port`:
  - `src/main/unlinkability.ts:3-14`.
  - Different proxy endpoints can still share the same exit IP or ASN.
- GeoIP is resolved dynamically on every launch:
  - `src/main/launch-args.ts:32-34` passes `geoip`, `timezone`, and `locale` into CloakBrowser every launch.
  - If a rotating proxy changes exit IP, timezone, locale, and WebRTC IP may change as well.
- CloakBrowser can auto-update its browser binary, which can change seed-to-fingerprint mapping:
  - `CloakBrowser/js/src/download.ts:603-611` triggers a background update check.
  - `CloakBrowser/js/src/download.ts:587-594` downloads a new binary and uses it on a later launch.
- The stored fingerprint snapshot is display data, not the launch source of truth:
  - `src/main/browser-manager.ts:45-54` probes and stores `fingerprint` / `visitorId` when missing.
  - Future launches still rebuild launch args from current config.

## Recommended Changes By Priority

### P0 - Lock Identity After First Setup

Add a resolved identity object to `Profile`:

```ts
interface ResolvedIdentity {
  locked: boolean;
  lockedAt: string;
  cloakBrowserVersion: string;
  fingerprintSeed: number;
  platform: FingerprintPlatform;
  proxy: ProxyConfig | null;
  exitIp: string | null;
  exitCountry: string | null;
  exitTimezone: string | null;
  locale: string | null;
  webrtcIp: string | null;
  userAgent: string;
  screen: { width: number; height: number; colorDepth: number };
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  webglVendor: string | null;
  webglRenderer: string | null;
  visitorId: string | null;
}
```

Reason:
- Platforms need to see the same profile as the same device over time.
- A fixed seed alone is not enough if proxy, GeoIP, or browser binary changes.

Implementation:
- On profile creation, set `identityLocked = false` and `resolvedIdentity = null`.
- On first setup after proxy test succeeds, resolve exit IP, timezone, locale, WebRTC IP, capture fingerprint, and save them into `resolvedIdentity`.
- On future launches:
  - use the stored timezone and locale;
  - do not run dynamic GeoIP again;
  - reuse the same seed and platform;
  - compare the current proxy exit IP against `resolvedIdentity.exitIp`;
  - warn or block launch when drift is detected.

### P0 - Disable Auto-Update Or Pin Browser Version

Reason:
- CloakBrowser binary version is part of the fingerprint surface.
- The same seed on a different binary version can produce a different user agent, GPU, or hardware mapping.

Evidence:
- `CloakBrowser/js/src/download.ts:63-70` chooses the effective binary.
- `CloakBrowser/js/src/download.ts:603-611` auto-triggers update checks.
- `CloakBrowser/js/src/download.ts:587-594` downloads a newer binary for future launches.

Implementation:
- Set `CLOAKBROWSER_AUTO_UPDATE=false` in the main process before calling `ensureBinary()`.
- Save `cloakBrowserVersion` into `resolvedIdentity` when locking identity.
- Do not auto-migrate old profiles to a new browser binary. Provide an explicit "Migrate browser version" action and label it as an identity-changing operation.

### P0 - Freeze GeoIP After Identity Lock

Reason:
- Automatic GeoIP is useful during first setup, but risky after the profile has been used.
- If `geoip: true` remains active, timezone, locale, and WebRTC IP can change when proxy exit IP changes.

Evidence:
- `src/main/launch-args.ts:32` passes `geoip: p.proxy ? p.geoip : false`.
- `CloakBrowser/js/src/playwright.ts:222-229` resolves GeoIP and injects WebRTC IP when an exit IP is available.

Implementation:
- During initial setup, allow `geoip: true` to discover timezone, locale, and exit IP.
- After locking identity, launch with `geoip: false` and pass the stored timezone and locale explicitly.
- If a specific WebRTC IP is available, pass `--fingerprint-webrtc-ip=${resolvedIdentity.webrtcIp}` instead of `auto`.
- If exit IP or GeoIP cannot be resolved, do not lock identity. Show a clear "proxy identity not resolved" error.

### P0 - Detect Proxy Conflicts By Actual Exit IP

Reason:
- Multiple proxy endpoints can share the same exit IP or subnet.
- Matching `host:port` only catches the simplest conflict.

Evidence:
- `src/main/unlinkability.ts:3-14` groups profiles by `${host}:${port}`.
- `src/main/proxy-tester.ts:19-23` returns only the IP from `api.ipify.org`.

Implementation:
- Extend `ProxyTestResult` with `exitIp`, `country`, `city`, `timezone`, `asn`, `isp`, `webrtcIp`, and `dnsLeakSuspected`.
- Store recent proxy test results per profile.
- Add conflict rules:
  - high: another profile uses the same `exitIp`;
  - medium: same ASN/ISP plus same country/city;
  - high: profile has no proxy;
  - high: WebRTC IP differs from HTTP exit IP when WebRTC is allowed/replaced;
  - high: timezone or locale does not match proxy geography.

### P0 - Block Launch When A Locked Identity Drifts

Reason:
- If platform, timezone, proxy exit IP, or browser version changes after account warm-up, platforms may see a device/environment change.

Implementation:
- Add `preflightIdentityCheck(profile)` before `manager.launch`.
- If `resolvedIdentity.locked === true`, check:
  - current CloakBrowser version equals locked version;
  - seed equals locked seed;
  - platform equals locked platform;
  - actual proxy exit IP equals locked exit IP when sticky proxy is required;
  - launch timezone and locale equal locked values;
  - custom launch args do not introduce identity-impacting flags.
- Default behavior should block P0 mismatch. Offer an explicit "Launch anyway and mark identity changed" override if needed.

### P1 - Add Fingerprint Fields That Need Freezing

Reason:
- BitBrowser exposes many fields because browser identity is larger than a seed.
- CloakBrowser-Manager already models several fields that `uiauia-login` lacks.

Reference evidence:
- `CloakBrowser-Manager/backend/models.py:10-32` includes `screen_width`, `screen_height`, `gpu_vendor`, `gpu_renderer`, `hardware_concurrency`, `user_agent`, `color_scheme`, and `launch_args`.
- `CloakBrowser-Manager/backend/browser_manager.py:379-415` maps those fields to fingerprint flags.

Implementation:
- Add these fields to `Profile`:
  - `browserVersionMode: 'pinned' | 'latest'`;
  - `screenWidth`, `screenHeight`, `windowWidth`, `windowHeight`;
  - `gpuVendor`, `gpuRenderer`;
  - `hardwareConcurrency`, `deviceMemory`;
  - `userAgentMode: 'seed' | 'custom'`;
  - `colorScheme`;
  - `webRtcMode: 'replace' | 'block'`;
  - `geolocationMode: 'ask' | 'allow' | 'block'`;
  - `doNotTrack`;
  - `launchArgs`.
- Split the UI into "Basic", "Proxy", "Identity Lock", and "Advanced Fingerprint".
- Keep advanced defaults simple, but store enough data to freeze identity.

### P1 - Invalidate Snapshot On Identity-Impacting Edits

Reason:
- `store.update` currently merges patches, so stale `fingerprint` / `visitorId` data can remain visible after changing proxy, timezone, locale, or platform.

Evidence:
- `src/main/store.ts:75-79` uses `Object.assign(p, patch)`.

Implementation:
- Define an identity-impacting field list:
  - `seed`, `platform`, `proxy`, `geoip`, `timezone`, `locale`, screen, GPU, CPU, RAM, user agent, WebRTC, browser version, and launch args.
- When these fields change:
  - if the profile is unlocked, clear `fingerprint`, `visitorId`, and `resolvedIdentity`;
  - if the profile is locked, reject the edit or require an explicit identity reset.

### P1 - Move Fingerprint Probe To Diagnostic Mode

Reason:
- The current first launch navigates to `https://example.com` and imports the FingerprintJS CDN. That can create unnecessary history/cache/network traces inside the real profile.

Evidence:
- `src/main/browser-manager.ts:16-17` defines `PROBE_URL = 'https://example.com'`.
- `src/main/browser-manager.ts:45-54` probes before navigating to the start URL.
- `src/main/fingerprint-probe.ts` imports FingerprintJS from a remote CDN.

Implementation:
- Add a `diagnosticsEnabled` setting.
- When identity locking requires a fingerprint read:
  - either clear history/cache for `example.com` and the CDN after probing;
  - or use a local diagnostic page for navigator/screen/WebGL reads;
  - run remote FingerprintJS only when the user explicitly clicks "Run external fingerprint check".

### P1 - Use Native macOS By Default On macOS

Reason:
- CloakBrowser itself warns that spoofing Windows on macOS can create font/GPU mismatches.

Evidence:
- `CloakBrowser/cloakbrowser/config.py:43-45` notes that Windows spoofing on macOS can be detectable.
- `src/main/store.ts:58` currently defaults to `platform: input.platform ?? 'windows'`.
- `src/renderer/components/ProfileForm.tsx:128-129` recommends Windows over macOS.

Implementation:
- If the app runs on macOS, default new profiles to `platform = 'macos'`.
- If the user selects Windows on macOS, show a cross-OS mismatch warning.
- For long-lived Google profiles, prefer native OS + per-profile proxy + per-profile seed over cross-OS spoofing.

### P2 - Add Workflow Fields: Cookies, Start URLs, Tags, Groups

Reason:
- These are not the core anti-detect layer, but they matter for operating many profiles.
- BitBrowser includes cookie import/export, groups, labels, notes, credentials, and multiple start URLs.

Implementation:
- Add `groupId`, `tags`, `notes`, `platformName`, `username`, and encrypted password / 2FA secret if needed.
- Add cookie import/export with JSON validation.
- Add multiple start URLs.
- Do this after P0/P1 because these features do not solve fingerprint stability.

## Minimal Data Model Proposal

```ts
interface Profile {
  id: string;
  name: string;
  seed: number;
  platform: FingerprintPlatform;
  proxy: ProxyConfig | null;
  proxyPolicy: 'sticky-required' | 'allow-rotation';
  identityLocked: boolean;
  resolvedIdentity: ResolvedIdentity | null;
  fingerprint: Fingerprint | null;
  visitorId: string | null;
  browserVersionPolicy: {
    mode: 'pinned' | 'manual';
    version: string | null;
  };
  fingerprintConfig: {
    screenWidth: number | null;
    screenHeight: number | null;
    windowWidth: number | null;
    windowHeight: number | null;
    gpuVendor: string | null;
    gpuRenderer: string | null;
    hardwareConcurrency: number | null;
    deviceMemory: number | null;
    userAgent: string | null;
    colorScheme: 'light' | 'dark' | 'no-preference' | null;
    webRtcMode: 'replace' | 'block';
    doNotTrack: boolean | null;
  };
}
```

## Proposed Launch Flow

### Unlocked Profile

1. User enters proxy and fingerprint options.
2. App tests proxy:
   - HTTP exit IP;
   - country/city/timezone;
   - ASN/ISP;
   - WebRTC IP after a test launch.
3. App launches with `geoip: true` or explicit timezone/locale if the user set them.
4. App captures the fingerprint snapshot.
5. User clicks "Lock identity".
6. App saves `resolvedIdentity` and future launches stop using dynamic randomization or dynamic GeoIP.

### Locked Profile

1. App loads `resolvedIdentity`.
2. Preflight checks:
   - browser binary version;
   - proxy exit IP;
   - timezone/locale;
   - seed/platform;
   - identity-impacting args.
3. If checks pass, launch with frozen config.
4. After launch, capture a lightweight local fingerprint and compare it with the stored snapshot.
5. If mismatch is detected, show a warning and do not overwrite the snapshot unless the user explicitly accepts the new identity.

## Recommended Implementation Order

1. Disable CloakBrowser auto-update and expose browser binary version in the UI.
2. Add `resolvedIdentity`, `identityLocked`, and schema migration.
3. Add preflight identity checks and block launch on mismatch.
4. Change GeoIP from "resolve every launch" to "resolve once, then freeze".
5. Extend proxy tester and conflict detection to actual exit IP.
6. Add lock/reset identity UI.
7. Extend fingerprint config with screen, GPU, CPU, RAM, color scheme, user agent, and launch args.
8. Move diagnostic fingerprint checks out of default launch.
9. Add stability tests:
   - same profile + same config -> same fingerprint snapshot;
   - locked profile + changed proxy exit IP -> block;
   - locked profile + changed browser version -> block;
   - editing platform/timezone/locale while locked -> reject or require reset.

## Completion Criteria

- A locked profile launched 10 times with the same sticky proxy and same browser binary keeps the same core fingerprint snapshot.
- Two different profiles on the same physical machine have different or plausibly distinct visitor IDs, WebGL, screen/window, and hardware identity.
- The app warns or blocks when a locked profile's proxy exit IP changes.
- The app does not silently change browser binary for locked profiles.
- The user cannot accidentally edit proxy, timezone, platform, seed, or browser version for a locked profile without a warning.

