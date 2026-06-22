import { EventEmitter } from 'events';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs } from './launch-args';
import { captureFingerprint, captureFingerprintDiagnostics } from './fingerprint-probe';
import { IdentityService } from './identity-service';
import { proxyWarnings } from './unlinkability';
import { IdentityDriftError, type Fingerprint, type FingerprintDiagnostics, type LaunchResult } from './types';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (page: Page) => Promise<Fingerprint>;
type DiagnosticsCapturer = (page: Page) => Promise<FingerprintDiagnostics>;

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
  ) { super(); }

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

    const ctx = await this.launcher(buildLaunchArgs(profile));
    this.running.set(id, ctx);
    ctx.on('close', () => {
      this.running.delete(id);
      this.emit('status-changed', id, false);
    });

    const page = ctx.pages()[0] ?? (await ctx.newPage());

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
    await page.goto(profile.startUrl || DEFAULT_START_URL).catch(() => {});

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
  }

  isRunning(id: string): boolean { return this.running.has(id); }
  runningIds(): string[] { return [...this.running.keys()]; }
}
