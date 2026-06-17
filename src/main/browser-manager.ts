import { EventEmitter } from 'events';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs } from './launch-args';
import { captureFingerprint, captureVisitorId } from './fingerprint-probe';
import type { Fingerprint } from './types';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (page: Page) => Promise<Fingerprint>;

/** Fallback landing page when a profile has no custom startUrl. */
export const DEFAULT_START_URL = 'https://www.google.com';

/** Controlled, CSP-free origin used to probe fingerprint + FingerprintJS id. */
const PROBE_URL = 'https://example.com';

export class BrowserManager extends EventEmitter {
  private running = new Map<string, BrowserContext>();

  constructor(
    private store: ProfileStore,
    private launcher: Launcher = launchPersistentContext,
    private capturer: Capturer = captureFingerprint,
    private visitorCapturer: (page: Page) => Promise<string | null> = captureVisitorId,
  ) { super(); }

  async launch(id: string): Promise<void> {
    if (this.running.has(id)) return;
    const profile = this.store.get(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);

    const ctx = await this.launcher(buildLaunchArgs(profile));
    this.running.set(id, ctx);
    ctx.on('close', () => {
      this.running.delete(id);
      this.emit('status-changed', id, false);
    });

    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // First time we see this profile, probe its fingerprint (and FingerprintJS
    // visitor id) on a controlled origin, then move on to the landing page.
    if (!profile.fingerprint || !profile.visitorId) {
      await page.goto(PROBE_URL).catch(() => {});
      if (!profile.fingerprint) {
        const fp = await this.capturer(page);
        await this.store.update(id, { fingerprint: fp });
      }
      if (!profile.visitorId) {
        const vid = await this.visitorCapturer(page).catch(() => null);
        if (vid) await this.store.update(id, { visitorId: vid });
      }
    }

    await this.store.update(id, { lastOpenedAt: new Date().toISOString() });
    await page.goto(profile.startUrl || DEFAULT_START_URL).catch(() => {});

    this.emit('status-changed', id, true);
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
