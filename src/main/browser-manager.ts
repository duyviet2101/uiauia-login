import { EventEmitter } from 'events';
import type { BrowserContext } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { launchPersistentContext } from 'cloakbrowser';
import type { ProfileStore } from './store';
import { buildLaunchArgs } from './launch-args';
import { captureFingerprint } from './fingerprint-probe';
import type { Fingerprint } from './types';

type Launcher = (opts: LaunchPersistentContextOptions) => Promise<BrowserContext>;
type Capturer = (ctx: BrowserContext) => Promise<Fingerprint>;

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

    if (!profile.fingerprint) {
      const fp = await this.capturer(ctx);
      await this.store.update(id, { fingerprint: fp });
    }
    await this.store.update(id, { lastOpenedAt: new Date().toISOString() });
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
