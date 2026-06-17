import { EventEmitter } from 'events';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs } from './launch-args';
import { captureFingerprint } from './fingerprint-probe';
import type { Fingerprint } from './types';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (page: Page) => Promise<Fingerprint>;

/**
 * Page the browser lands on after launch. Playwright opens a persistent
 * context on a bare about:blank tab; we navigate it somewhere usable so the
 * user isn't greeted by an empty page. Change this to taste.
 */
const START_URL = 'https://www.google.com';

export class BrowserManager extends EventEmitter {
  private running = new Map<string, BrowserContext>();

  constructor(
    private store: ProfileStore,
    private launcher: Launcher = launchPersistentContext,
    private capturer: Capturer = captureFingerprint,
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

    // Reuse the context's default page rather than opening another tab.
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    if (!profile.fingerprint) {
      const fp = await this.capturer(page);
      await this.store.update(id, { fingerprint: fp });
    }
    await this.store.update(id, { lastOpenedAt: new Date().toISOString() });

    // Land on a usable page (best-effort — don't fail the launch on nav error).
    await page.goto(START_URL).catch(() => {});

    this.emit('status-changed', id, true);
  }

  async stop(id: string): Promise<void> {
    const ctx = this.running.get(id);
    if (ctx) await ctx.close();
    this.running.delete(id);
  }

  isRunning(id: string): boolean { return this.running.has(id); }
  runningIds(): string[] { return [...this.running.keys()]; }
}
