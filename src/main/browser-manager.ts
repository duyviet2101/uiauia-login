import { EventEmitter } from 'events';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs, type Display } from './launch-args';
import { captureFingerprint, captureFingerprintDiagnostics } from './fingerprint-probe';
import { IdentityService } from './identity-service';
import { proxyWarnings } from './unlinkability';
import { IdentityDriftError, ProxyPreflightError, type Fingerprint, type FingerprintBaseline, type FingerprintDiagnostics, type LaunchResult, type Profile, type ProxyCheckSnapshot, type ProxyPrecheckResult } from './types';
import { NullProfileWindowService, type ProfileWindowService } from './profile-window-service';
import { prepareBrowserPreferences, type BrowserPreferencesOptions } from './browser-preferences';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (page: Page) => Promise<Fingerprint>;
type DiagnosticsCapturer = (page: Page) => Promise<FingerprintDiagnostics>;
type PreferencesPreparer = (userDataDir: string, opts: BrowserPreferencesOptions) => void | Promise<void>;

/** Fallback landing page when a profile has no custom startUrl. */
export const DEFAULT_START_URL = 'https://www.google.com';

export class BrowserManager extends EventEmitter {
  private running = new Map<string, BrowserContext>();

  constructor(
    private store: ProfileStore,
    private launcher: Launcher = launchPersistentContext,
    private capturer: Capturer = captureFingerprint,
    private diagnosticsCapturer: DiagnosticsCapturer = captureFingerprintDiagnostics,
    private identityService: IdentityService = new IdentityService(),
    /** Reads the real monitor so the spoofed screen matches it (window stays
     *  on-screen + fullscreen works). Injected to keep this unit-testable. */
    private displayProvider: () => Display = () => ({ width: 1920, height: 1080 }),
    private profileWindowService: ProfileWindowService = new NullProfileWindowService(),
    private preferencesPreparer: PreferencesPreparer = prepareBrowserPreferences,
  ) { super(); }

  /**
   * Pre-launch proxy gate for the manual "Open" action. When the profile has a
   * proxy, test it and cache the result (so a locked launch immediately after
   * reuses it within the TTL instead of testing twice). A proxyless profile
   * returns tested:false so the caller opens directly.
   */
  async precheckProxy(id: string): Promise<ProxyPrecheckResult> {
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    if (!profile.proxy) return { tested: false, ok: true };
    const snapshot = await this.identityService.checkProxy(profile.proxy);
    await this.store.setLastProxyCheck(id, snapshot);
    return { tested: true, ok: snapshot.ok, error: snapshot.error, snapshot };
  }

  async launch(id: string, opts: { force?: boolean } = {}): Promise<LaunchResult> {
    if (this.running.has(id)) return { launched: true, lockedNow: false, warnings: proxyWarnings(this.store.list()) };
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    // Every check that could stop this launch happens here, before Chromium
    // exists. Past `this.launcher(...)` there is no gate left — see preflight().
    const snapshot = await this.preflight(id, profile, opts);

    try {
      await this.preferencesPreparer(profile.userDataDir, {
        blockGeolocation: profile.blockGeolocation,
        doNotTrack: profile.doNotTrack,
      });
    } catch (error) {
      // A damaged/locked Preferences file must not make the whole profile
      // unusable; launch with Chromium defaults and surface the diagnostic.
      console.warn(`[browser-preferences] Could not prepare profile ${id}:`, error);
    }

    const ctx = await this.launcher(buildLaunchArgs(profile, this.displayProvider()));
    this.running.set(id, ctx);
    ctx.on('close', () => {
      this.profileWindowService.detach(id);
      this.running.delete(id);
      this.emit('status-changed', id, false);
    });

    await this.profileWindowService.attach(profile, ctx).catch((error) => {
      console.warn(`[window-customization] Attach failed for ${id}:`, error);
    });

    const restoredPage = await this.findRestoredPage(ctx, profile.lastOpenedAt !== null);
    if (restoredPage) await this.closeBootstrapBlankPages(ctx, restoredPage);
    const page = restoredPage ?? ctx.pages()[0] ?? (await ctx.newPage());

    // Probe local navigator/screen/WebGL on EVERY launch. External
    // FingerprintJS/CDN checks stay diagnostic-only, so a normal launch still
    // adds no third-party network/cache traces to the profile.
    //
    // This used to run only when the profile had no fingerprint yet, which meant
    // the app never looked again after the first launch and could not have
    // noticed a change if one happened.
    const visitorId = profile.visitorId;
    const engineVersion = this.identityService.currentEngineVersion();
    let fingerprint: Fingerprint | null = null;
    try {
      fingerprint = await this.capturer(page);
      await this.store.recordObservation(id, fingerprint, engineVersion);
      // A profile with no baseline has nothing to overwrite, so the first
      // reading becomes the baseline. A profile that already has one keeps it:
      // accepting a change is a user decision (acceptBaseline), never a side
      // effect of opening the browser.
      if (!profile.baseline) {
        await this.store.acceptBaseline(id, fingerprint, engineVersion, 'first-launch');
      }
    } catch (error) {
      // Leave lastObservation as it was — an empty reading is not evidence that
      // nothing changed — and RECORD the failure, so profileHealth() can say a
      // check failed instead of inferring it from missing data.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[fingerprint] Could not read fingerprint for ${id}:`, error);
      await this.store.recordObservationFailure(id, message).catch(() => {});
    }

    // Lock on the snapshot preflight already took. This used to run its own
    // checkProxy here, which is why an unlocked profile's proxy was first tested
    // AFTER the session had been restored.
    let lockedNow = false;
    if (!profile.identityLocked && profile.proxy && fingerprint && snapshot?.ok && snapshot.exitIp) {
      const identity = this.identityService.lockIdentityFromLaunch(profile, fingerprint, visitorId, snapshot);
      await this.store.lockIdentity(id, identity, snapshot);
      lockedNow = true;
    }

    await this.store.update(id, { lastOpenedAt: new Date().toISOString() });
    // Never overwrite a restored tab. A start URL/default Google page is only
    // for a first launch or when Chromium genuinely has no previous page.
    if (!restoredPage) await page.goto(profile.startUrl || DEFAULT_START_URL).catch(() => {});

    this.emit('status-changed', id, true);
    return { launched: true, lockedNow, warnings: proxyWarnings(this.store.list()) };
  }

  async runDiagnostics(id: string): Promise<FingerprintDiagnostics> {
    if (!this.running.has(id)) await this.launch(id);
    const ctx = this.running.get(id);
    if (!ctx) throw new Error('Browser not running');
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const diagnostics = await this.diagnosticsCapturer(page);
    await this.store.update(id, { diagnostics });
    return diagnostics;
  }

  /**
   * Open a locked profile while accepting the current *network* environment:
   * re-align the locked exit IP to what the proxy resolves now, then launch
   * without the drift block. Keeps seed, fingerprint, and session data — the
   * safe alternative to resetting identity.
   *
   * The engine version is NOT re-baselined unless `acceptEngine` is passed.
   * Accepting a rotated IP and accepting a browser upgrade are separate
   * decisions: the upgrade changes what a site fingerprints, the IP does not.
   */
  async forceLaunch(id: string, opts: { acceptEngine?: boolean } = {}): Promise<LaunchResult> {
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    if (profile.identityLocked && profile.resolvedIdentity) {
      let snapshot;
      if (profile.proxy) {
        snapshot = await this.identityService.checkProxy(profile.proxy);
        await this.store.setLastProxyCheck(id, snapshot);
      }
      const patch = {
        ...this.identityService.reconcilePatch(snapshot),
        ...(opts.acceptEngine ? this.identityService.enginePatch() : {}),
      };
      if (Object.keys(patch).length > 0) await this.store.reconcileLockedIdentity(id, patch);
    }
    return this.launch(id, { force: true });
  }

  /**
   * Re-baseline a locked identity onto the engine version that is installed now,
   * without opening the browser. Explicit user action; returns the version that
   * was accepted so the caller can report it.
   */
  async acceptEngineVersion(id: string): Promise<string> {
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    if (!profile.identityLocked || !profile.resolvedIdentity) {
      throw new Error('Profile identity is not locked; nothing to re-baseline.');
    }
    const patch = this.identityService.enginePatch();
    await this.store.reconcileLockedIdentity(id, patch);
    return patch.cloakBrowserVersion!;
  }

  /**
   * Adopt the latest observation as the profile's baseline — the explicit
   * "yes, this change is mine" action.
   *
   * Requires an observation to adopt. Accepting with nothing measured would
   * write the old baseline back over itself and report success, which is worse
   * than refusing.
   */
  async acceptCurrentFingerprint(id: string): Promise<FingerprintBaseline> {
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    const observation = profile.lastObservation;
    if (!observation) throw new Error('Chưa có lần đo nào để chấp nhận. Mở profile một lần rồi thử lại.');
    return this.store.acceptBaseline(id, observation.fingerprint, observation.engineVersion, 'user-accepted');
  }

  /** Launch the profile if needed, then navigate its window to `url`
   *  (used by the "Test fingerprint" button). */
  async openUrl(id: string, url: string): Promise<void> {
    if (!this.running.has(id)) await this.launch(id);
    const ctx = this.running.get(id);
    if (!ctx) throw new Error('Browser not running');
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.bringToFront().catch(() => {});
    await page.goto(url).catch(() => {});
  }

  async stop(id: string): Promise<void> {
    const ctx = this.running.get(id);
    if (ctx) await ctx.close();
    this.running.delete(id);
    this.profileWindowService.detach(id);
  }

  async refreshWindowCustomization(id: string): Promise<void> {
    if (!this.running.has(id)) return;
    const profile = this.store.get(id);
    if (profile) {
      await this.profileWindowService.refresh(profile).catch((error) => {
        console.warn(`[window-customization] Refresh failed for ${id}:`, error);
      });
    }
  }

  dispose(): void {
    this.profileWindowService.dispose();
  }

  isRunning(id: string): boolean { return this.running.has(id); }
  runningIds(): string[] { return [...this.running.keys()]; }

  /**
   * Everything that must hold BEFORE `launchPersistentContext`.
   *
   * The launch args carry `--restore-last-session` and the matching
   * `session.restore_on_startup` preference, so the instant the context opens
   * Chromium replays the profile's previous tabs — cookies, tokens and all —
   * with no further chance to intervene. A check made after that call is not a
   * gate, it is a log entry. Two consequences:
   *
   *  1. The locked-identity comparison runs here (it always did).
   *  2. The proxy of an UNLOCKED profile is tested here too. It used to be
   *     tested after the launch, purely to decide whether to lock, which left a
   *     returning profile replaying its session through an unverified exit.
   *
   * A profile that would restore a session is blocked when its proxy does not
   * resolve an exit IP. A first launch is let through: its cookie jar is empty,
   * so a broken proxy costs the user an error page, not linkage.
   *
   * `force` means "I accept the drift", not "skip the proxy" — a forced launch
   * restores the same session and is held to the same rule.
   *
   * Returns the snapshot the caller may reuse (locking, warnings) so the proxy
   * is never tested twice for one launch.
   */
  private async preflight(
    id: string,
    profile: Profile,
    opts: { force?: boolean },
  ): Promise<ProxyCheckSnapshot | undefined> {
    let snapshot: ProxyCheckSnapshot | undefined;

    if (profile.identityLocked && !opts.force) {
      const result = await this.identityService.checkLockedIdentity(profile);
      // Persist a freshly-fetched proxy check so the next open can reuse it (TTL).
      if (result.snapshot && !result.fromCache) await this.store.setLastProxyCheck(id, result.snapshot);
      if (!result.ok) throw new IdentityDriftError(result.drift);
      snapshot = result.snapshot;
    }

    if (profile.proxy && !snapshot) {
      // Same freshness rule as the locked path — a failed or stale snapshot is
      // not evidence, so it is re-tested rather than trusted.
      const cached = profile.lastProxyCheck;
      if (this.identityService.isSnapshotUsable(cached)) {
        snapshot = cached;
      } else {
        snapshot = await this.identityService.checkProxy(profile.proxy);
        await this.store.setLastProxyCheck(id, snapshot);
      }
    }

    if (profile.proxy && this.wouldRestoreSession(profile) && !(snapshot?.ok && snapshot.exitIp)) {
      throw new ProxyPreflightError(snapshot?.error ?? 'Proxy không trả về exit IP.', snapshot);
    }

    return snapshot;
  }

  /**
   * Whether this launch would replay a previous session. Uses the same signal
   * `findRestoredPage` waits on, so the gate and the restore never disagree:
   * a profile that has been opened before may have a session on disk, and we
   * treat "may" as "will" because the answer only becomes visible after launch.
   */
  private wouldRestoreSession(profile: Profile): boolean {
    return profile.lastOpenedAt !== null;
  }

  private async findRestoredPage(context: BrowserContext, returning: boolean): Promise<Page | null> {
    const meaningful = () => context.pages().find((page) => {
      const url = page.url();
      return !!url && url !== 'about:blank';
    }) ?? null;
    let page = meaningful();
    if (page || !returning) return page;

    // Session restore can begin just after launchPersistentContext resolves.
    // Give Chromium a short window before deciding there was nothing to restore.
    for (let attempt = 0; attempt < 20 && !page; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      page = meaningful();
    }
    return page;
  }

  private async closeBootstrapBlankPages(context: BrowserContext, restoredPage: Page): Promise<void> {
    const blanks = context.pages().filter((page) => page !== restoredPage && page.url() === 'about:blank');
    await Promise.all(blanks.map((page) => page.close().catch(() => {})));
  }
}
