import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import type { Profile } from '../src/main/types';
import { WindowsProfileWindowService } from '../src/main/windows-profile-window-service';
import type {
  NativeChromeWindow,
  NativeHandle,
  WindowsNativeAdapter,
} from '../src/main/windows-native-adapter';

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1', name: 'Account', seed: 1, platform: 'windows', proxy: null, geoip: true,
    timezone: null, locale: null, startUrl: null, userDataDir: '/tmp/p1', fingerprint: null,
    visitorId: null, diagnostics: null, identityLocked: false, resolvedIdentity: null,
    lastProxyCheck: null, windowCustomization: { enabled: true, number: 12, color: '#2563EB' },
    createdAt: '', lastOpenedAt: null, ...over,
  };
}

function context(pid = 4321) {
  const detach = vi.fn(async () => {});
  const send = vi.fn(async () => ({ processInfo: [{ type: 'browser', id: pid }] }));
  const ctx = {
    browser: () => ({ newBrowserCDPSession: async () => ({ send, detach }) }),
  } as unknown as BrowserContext;
  return { ctx, send, detach };
}

class FakeNative implements WindowsNativeAdapter {
  windows: NativeChromeWindow[] = [{ hwnd: 100n, pid: 4321, title: 'Website' }];
  icons = new Map<string, NativeHandle>([['100:small', 10n], ['100:big', 11n]]);
  titles: Array<[bigint, string]> = [];
  setIcons: Array<[bigint, string, NativeHandle]> = [];
  destroyed: bigint[] = [];
  nextIcon = 1000n;

  enumerateChromeWindows() { return this.windows; }
  getIcon(hwnd: bigint, size: 'small' | 'big') { return this.icons.get(`${hwnd}:${size}`) ?? null; }
  setIcon(hwnd: bigint, size: 'small' | 'big', icon: NativeHandle) {
    this.icons.set(`${hwnd}:${size}`, icon);
    this.setIcons.push([hwnd, size, icon]);
    return true;
  }
  setTitle(hwnd: bigint, title: string) {
    const window = this.windows.find((item) => item.hwnd === hwnd);
    if (window) window.title = title;
    this.titles.push([hwnd, title]);
    return true;
  }
  loadIcons() { return { small: this.nextIcon++, big: this.nextIcon++ }; }
  destroyIcon(icon: bigint) { this.destroyed.push(icon); }
}

function makeService(native = new FakeNative()) {
  const cache = { get: vi.fn(() => '/tmp/icon.ico') };
  const service = new WindowsProfileWindowService(native, cache as any, { warn: vi.fn() });
  return { service, native, cache };
}

describe('WindowsProfileWindowService', () => {
  it('reads PID once, detaches CDP, then decorates only through native HWND APIs', async () => {
    const { service, native } = makeService();
    const cdp = context();
    await service.attach(profile(), cdp.ctx);

    expect(cdp.send).toHaveBeenCalledWith('SystemInfo.getProcessInfo');
    expect(cdp.detach).toHaveBeenCalledOnce();
    expect(native.windows[0].title).toBe('[#12] Account');
    expect(native.getIcon(100n, 'small')).toBe(1000n);
    expect(native.getIcon(100n, 'big')).toBe(1001n);
    service.detach('p1');
  });

  it('reapplies after Chromium overwrites title and restores the latest browser title when disabled', async () => {
    const { service, native } = makeService();
    await service.attach(profile(), context().ctx);
    native.windows[0].title = 'New website title';

    await service.refresh(profile({ name: 'Renamed' }));
    expect(native.windows[0].title).toBe('[#12] Renamed');

    await service.refresh(profile({
      name: 'Renamed',
      windowCustomization: { enabled: false, number: 12, color: '#2563EB' },
    }));
    expect(native.windows[0].title).toBe('New website title');
    expect(native.getIcon(100n, 'small')).toBe(10n);
    expect(native.getIcon(100n, 'big')).toBe(11n);
    service.detach('p1');
  });

  it('decorates newly-created browser windows and reloads icons after a live color change', async () => {
    const { service, native, cache } = makeService();
    await service.attach(profile(), context().ctx);
    native.windows.push({ hwnd: 200n, pid: 4321, title: 'Popup' });

    await service.refresh(profile({
      windowCustomization: { enabled: true, number: 12, color: '#DC2626' },
    }));
    expect(native.windows[1].title).toBe('[#12] Account');
    expect(cache.get).toHaveBeenCalledTimes(2);
    expect(native.getIcon(200n, 'small')).toBe(1002n);
    service.detach('p1');
    expect(native.destroyed).toEqual([1000n, 1001n, 1002n, 1003n]);
  });

  it('still applies the native title when icon generation fails', async () => {
    const native = new FakeNative();
    const warn = vi.fn();
    const cache = { get: vi.fn(() => { throw new Error('icon renderer unavailable'); }) };
    const service = new WindowsProfileWindowService(native, cache as any, { warn });

    await service.attach(profile(), context().ctx);
    expect(native.windows[0].title).toBe('[#12] Account');
    expect(warn).toHaveBeenCalledOnce();

    await service.refresh(profile());
    expect(warn).toHaveBeenCalledOnce();
    service.detach('p1');
  });
});
