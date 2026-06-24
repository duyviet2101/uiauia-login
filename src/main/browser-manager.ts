import { EventEmitter } from 'events';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs, type Display } from './launch-args';
import { captureFingerprint, captureFingerprintDiagnostics } from './fingerprint-probe';
import { IdentityService } from './identity-service';
import { proxyWarnings } from './unlinkability';
import { IdentityDriftError, type Fingerprint, type FingerprintDiagnostics, type LaunchResult, type ProxyPrecheckResult } from './types';
import { NullProfileWindowService, type ProfileWindowService } from './profile-window-service';
import { prepareBrowserPreferences, type BrowserPreferencesOptions } from './browser-preferences';
import { resolveWindowsFontsDir } from './fonts-dir';

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
    /** Bundled Windows font dir for --fingerprint-fonts-dir (hides host fonts on
     *  windows-spoof profiles). Resolves to null when no complete bundle ships. */
    private fontsDirProvider: () => string | null = resolveWindowsFontsDir,
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
    if (profile.identityLocked && !opts.force) {
      const result = await this.identityService.checkLockedIdentity(profile);
      // Persist a freshly-fetched proxy check so the next open can reuse it (TTL).
      if (result.snapshot && !result.fromCache) await this.store.setLastProxyCheck(id, result.snapshot);
      if (!result.ok) throw new IdentityDriftError(result.drift);
    }

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

    const ctx = await this.launcher(buildLaunchArgs(profile, this.displayProvider(), this.fontsDirProvider()));
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

    // First time we see this profile, probe local navigator/screen/WebGL only.
    // External FingerprintJS/CDN checks are diagnostic-only so normal launches
    // do not add third-party network/cache traces to the profile.
    let fingerprint = profile.fingerprint;
    const visitorId = profile.visitorId;
    if (!fingerprint) {
      fingerprint = await this.capturer(page);
      await this.store.update(id, { fingerprint });
    }

    let lockedNow = false;
    if (!profile.identityLocked && profile.proxy && fingerprint) {
      const proxySnapshot = await this.identityService.checkProxy(profile.proxy);
      await this.store.setLastProxyCheck(id, proxySnapshot);
      if (proxySnapshot.ok && proxySnapshot.exitIp) {
        const identity = this.identityService.lockIdentityFromLaunch(profile, fingerprint, visitorId, proxySnapshot);
        await this.store.lockIdentity(id, identity, proxySnapshot);
        lockedNow = true;
      }
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
   * Open a locked profile while accepting the current environment as the new
   * baseline: re-align the locked identity (exit IP, browser version) to what
   * the proxy resolves now, then launch without the drift block. Keeps seed,
   * fingerprint, and session data — the safe alternative to resetting identity.
   */
  async forceLaunch(id: string): Promise<LaunchResult> {
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    if (profile.identityLocked && profile.resolvedIdentity) {
      let snapshot;
      if (profile.proxy) {
        snapshot = await this.identityService.checkProxy(profile.proxy);
        await this.store.setLastProxyCheck(id, snapshot);
      }
      await this.store.reconcileLockedIdentity(id, this.identityService.reconcilePatch(snapshot));
    }
    return this.launch(id, { force: true });
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
