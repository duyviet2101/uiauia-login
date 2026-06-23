import type { BrowserContext } from 'playwright-core';
import type { Profile } from './types';
import { profileWindowTitle } from './profile-window-customization';
import { ProfileIconCache } from './profile-icon';
import type { ProfileWindowService } from './profile-window-service';
import type {
  LoadedWindowIcons,
  NativeChromeWindow,
  NativeHandle,
  WindowsNativeAdapter,
} from './windows-native-adapter';

interface WindowState {
  hwnd: bigint;
  originalTitle: string;
  lastBrowserTitle: string;
  lastAppliedTitle: string | null;
  originalSmall: NativeHandle;
  originalBig: NativeHandle;
}

interface RunningProfile {
  profile: Profile;
  context: BrowserContext;
  pid: number;
  generation: number;
  activeIcons: LoadedWindowIcons | null;
  iconFailureSignature: string | null;
  ownedIcons: LoadedWindowIcons[];
  windows: Map<string, WindowState>;
}

const POLL_INTERVAL_MS = 750;

export class WindowsProfileWindowService implements ProfileWindowService {
  private running = new Map<string, RunningProfile>();
  private generations = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanInProgress = false;

  constructor(
    private native: WindowsNativeAdapter,
    private iconCache: ProfileIconCache,
    private log: Pick<Console, 'warn'> = console,
  ) {}

  async attach(profile: Profile, context: BrowserContext): Promise<void> {
    const generation = (this.generations.get(profile.id) ?? 0) + 1;
    this.generations.set(profile.id, generation);
    try {
      const pid = await this.browserPid(context);
      if (this.generations.get(profile.id) !== generation) return;
      this.running.set(profile.id, {
        profile,
        context,
        pid,
        generation,
        activeIcons: null,
        iconFailureSignature: null,
        ownedIcons: [],
        windows: new Map(),
      });
      this.ensureTimer();
      await this.scan();
    } catch (error) {
      this.log.warn(`[window-customization] Could not attach profile ${profile.id}:`, error);
    }
  }

  async refresh(profile: Profile): Promise<void> {
    const running = this.running.get(profile.id);
    if (!running) return;
    const wasEnabled = running.profile.windowCustomization.enabled;
    const oldSignature = this.iconSignature(running.profile);
    running.profile = profile;

    if (!profile.windowCustomization.enabled) {
      if (wasEnabled) this.restore(running);
      return;
    }
    if (oldSignature !== this.iconSignature(profile)) {
      running.activeIcons = null;
      running.iconFailureSignature = null;
    }
    await this.scan();
  }

  detach(profileId: string): void {
    this.generations.set(profileId, (this.generations.get(profileId) ?? 0) + 1);
    const running = this.running.get(profileId);
    if (!running) return;
    this.running.delete(profileId);
    for (const icons of running.ownedIcons) {
      this.native.destroyIcon(icons.small);
      this.native.destroyIcon(icons.big);
    }
    if (!this.running.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    for (const profileId of [...this.running.keys()]) this.detach(profileId);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.scan(); }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  private async browserPid(context: BrowserContext): Promise<number> {
    const browser = context.browser();
    if (!browser) throw new Error('Persistent context has no owning Browser instance.');
    const session = await browser.newBrowserCDPSession();
    try {
      const result = await session.send('SystemInfo.getProcessInfo') as {
        processInfo: Array<{ type: string; id: number }>;
      };
      const process = result.processInfo.find((item) => item.type === 'browser');
      if (!process?.id) throw new Error('CDP did not return the browser PID.');
      return process.id;
    } finally {
      await session.detach().catch(() => {});
    }
  }

  private async scan(): Promise<void> {
    if (this.scanInProgress || !this.running.size) return;
    this.scanInProgress = true;
    try {
      const windows = this.native.enumerateChromeWindows();
      for (const running of this.running.values()) {
        const matches = windows.filter((window) => window.pid === running.pid);
        if (!running.profile.windowCustomization.enabled) continue;
        this.decorate(running, matches);
      }
    } catch (error) {
      this.log.warn('[window-customization] Native scan failed:', error);
    } finally {
      this.scanInProgress = false;
    }
  }

  private decorate(running: RunningProfile, windows: NativeChromeWindow[]): void {
    const desiredTitle = profileWindowTitle(
      running.profile.windowCustomization.number,
      running.profile.name,
    );
    const visibleKeys = new Set<string>();

    for (const window of windows) {
      const key = window.hwnd.toString();
      visibleKeys.add(key);
      let state = running.windows.get(key);
      if (!state) {
        state = {
          hwnd: window.hwnd,
          originalTitle: window.title,
          lastBrowserTitle: window.title,
          lastAppliedTitle: null,
          originalSmall: this.native.getIcon(window.hwnd, 'small'),
          originalBig: this.native.getIcon(window.hwnd, 'big'),
        };
        running.windows.set(key, state);
      }

      if (window.title !== desiredTitle) {
        if (window.title !== state.lastAppliedTitle) state.lastBrowserTitle = window.title;
        if (this.native.setTitle(window.hwnd, desiredTitle)) state.lastAppliedTitle = desiredTitle;
      }
    }

    // Title customization must remain useful even if icon rendering/loading fails.
    const icons = this.iconsFor(running);
    if (icons) {
      for (const window of windows) {
        if (this.native.getIcon(window.hwnd, 'small') !== icons.small) {
          this.native.setIcon(window.hwnd, 'small', icons.small);
        }
        if (this.native.getIcon(window.hwnd, 'big') !== icons.big) {
          this.native.setIcon(window.hwnd, 'big', icons.big);
        }
      }
    }

    for (const key of running.windows.keys()) {
      if (!visibleKeys.has(key)) running.windows.delete(key);
    }
  }

  private iconsFor(running: RunningProfile): LoadedWindowIcons | null {
    if (running.activeIcons) return running.activeIcons;
    const customization = running.profile.windowCustomization;
    const signature = this.iconSignature(running.profile);
    if (running.iconFailureSignature === signature) return null;
    try {
      const path = this.iconCache.get(
        running.profile.id,
        customization.number,
        customization.color,
      );
      const icons = this.native.loadIcons(path);
      running.activeIcons = icons;
      running.ownedIcons.push(icons);
      return icons;
    } catch (error) {
      running.iconFailureSignature = signature;
      this.log.warn(`[window-customization] Could not create icon for profile ${running.profile.id}:`, error);
      return null;
    }
  }

  private restore(running: RunningProfile): void {
    for (const state of running.windows.values()) {
      this.native.setTitle(state.hwnd, state.lastBrowserTitle || state.originalTitle);
      this.native.setIcon(state.hwnd, 'small', state.originalSmall);
      this.native.setIcon(state.hwnd, 'big', state.originalBig);
      state.lastAppliedTitle = null;
    }
  }

  private iconSignature(profile: Profile): string {
    return `${profile.windowCustomization.number}:${profile.windowCustomization.color}`;
  }
}
