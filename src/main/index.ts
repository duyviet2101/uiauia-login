import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron';
import { join } from 'path';
import { ensureBinary, binaryInfo } from 'cloakbrowser';
import { ProfileStore } from './store';
import { BrowserManager } from './browser-manager';
import { ProxyTester } from './proxy-tester';
import { registerIpc } from './ipc';
import { IdentityService } from './identity-service';
import { clearQuarantine } from './quarantine';
import type { InitState } from './types';
import { UpdateService, NullUpdater } from './update-service';
import { MacUpdater } from './mac-updater';
import { WinUpdater, resolveElectronAutoUpdater } from './win-updater';
import type { UpdaterAdapter, UpdateStatus } from './types';
import type { ProfileWindowService } from './profile-window-service';
import { NullProfileWindowService } from './profile-window-service';
import { ProfileIconCache } from './profile-icon';

let initState: InitState = { phase: 'starting', message: 'Đang khởi động…' };

function setInitState(next: InitState): void {
  initState = next;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:init-state', initState);
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#0f172a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload (.mjs) requires the sandbox to be off, otherwise
      // contextBridge never runs and window.api is undefined.
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Diagnostics — surface renderer/preload failures in the terminal.
  win.webContents.on('preload-error', (_e, path, error) => {
    console.error('[preload-error]', path, error);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url);
  });
  // console-message signature differs across Electron versions; log loosely.
  win.webContents.on('console-message', (...args: unknown[]) => {
    const detail = args[1];
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const d = detail as { level?: unknown; message?: unknown };
      console.log('[renderer]', d.level, d.message);
    } else {
      console.log('[renderer]', args[2]);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(async () => {
  process.env.CLOAKBROWSER_AUTO_UPDATE = 'false';

  // Window opens immediately and shows the startup screen while services boot.
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Always available so the renderer can query current state on mount,
  // even if it missed an earlier broadcast.
  ipcMain.handle('app:get-init-state', () => initState);
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:open-external', (_e, url: string) => shell.openExternal(url));

  try {
    setInitState({ phase: 'preparing-binary', message: 'Đang kiểm tra / tải trình duyệt CloakBrowser…' });
    await ensureBinary();

    try {
      const info = binaryInfo();
      await clearQuarantine(info.binaryPath);
    } catch {
      /* best-effort */
    }

    setInitState({ phase: 'starting-services', message: 'Đang khởi tạo dịch vụ…' });
    const store = new ProfileStore(app.getPath('userData'));
    await store.init();
    const proxyTester = new ProxyTester();
    const identityService = new IdentityService(proxyTester);
    let profileWindowService: ProfileWindowService = new NullProfileWindowService();
    if (process.platform === 'win32') {
      try {
        const [{ createKoffiWindowsAdapter }, { WindowsProfileWindowService }] = await Promise.all([
          import('./windows-native-adapter'),
          import('./windows-profile-window-service'),
        ]);
        const iconCache = new ProfileIconCache(app.getPath('userData'));
        iconCache.removeStale(new Set(store.list().map((profile) => profile.id)));
        profileWindowService = new WindowsProfileWindowService(
          await createKoffiWindowsAdapter(),
          iconCache,
        );
      } catch (error) {
        console.warn('[window-customization] Windows native service disabled:', error);
      }
    }
    const manager = new BrowserManager(store, undefined, undefined, undefined, identityService, () => {
      const s = screen.getPrimaryDisplay().size;
      return s.width > 0 && s.height > 0 ? { width: s.width, height: s.height } : { width: 1920, height: 1080 };
    }, profileWindowService);
    app.once('before-quit', () => manager.dispose());
    registerIpc(store, manager, proxyTester, identityService);

    const updateRepo = 'duyviet2101/uiauia-login';
    const plat: UpdateStatus['platform'] =
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'other';
    let updateAdapter: UpdaterAdapter;
    if (plat === 'win32') {
      try {
        const updaterModule = await import('electron-updater');
        updateAdapter = new WinUpdater(resolveElectronAutoUpdater(updaterModule));
      } catch (err) {
        console.error('[update] Windows updater disabled:', err);
        updateAdapter = new NullUpdater();
      }
    } else if (plat === 'darwin') {
      updateAdapter = new MacUpdater(updateRepo);
    } else {
      updateAdapter = new NullUpdater();
    }
    const updateService = new UpdateService(updateAdapter, app.getVersion(), plat, (status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:status', status);
      }
    });
    ipcMain.handle('update:check', () => updateService.check());
    ipcMain.handle('update:start', () => updateService.start());
    ipcMain.handle('update:apply', () => updateService.apply());

    setInitState({ phase: 'ready', message: '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[main] init error:', err);
    setInitState({ phase: 'error', message });
  }
}).catch((err) => {
  console.error('[main] whenReady error:', err);
  dialog.showErrorBox('Startup error', String(err));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
