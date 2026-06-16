import { ipcMain, BrowserWindow } from 'electron';
import type { ProfileStore } from './store';
import type { BrowserManager } from './browser-manager';
import type { ProxyTester } from './proxy-tester';
import { proxyWarnings } from './unlinkability';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, ProfileRuntime } from './types';

export function registerIpc(
  store: ProfileStore,
  manager: BrowserManager,
  proxyTester: ProxyTester,
) {
  const withRuntime = (): ProfileRuntime[] =>
    store.list().map((p) => ({ ...p, running: manager.isRunning(p.id) }));

  ipcMain.handle('profiles:list', () => withRuntime());
  ipcMain.handle('profiles:warnings', () => proxyWarnings(store.list()));
  ipcMain.handle('profiles:create', (_e, input: CreateProfileInput) => store.create(input));
  ipcMain.handle('profiles:update', (_e, id: string, patch: UpdateProfileInput) => store.update(id, patch));
  ipcMain.handle('profiles:duplicate', (_e, id: string) => store.duplicate(id));
  ipcMain.handle('profiles:delete', (_e, id: string) => store.remove(id));

  ipcMain.handle('browser:launch', (_e, id: string) => manager.launch(id));
  ipcMain.handle('browser:stop', (_e, id: string) => manager.stop(id));
  ipcMain.handle('browser:running', () => manager.runningIds());

  ipcMain.handle('proxy:test', (_e, proxy: ProxyConfig) => proxyTester.test(proxy));

  manager.on('status-changed', (id: string, running: boolean) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('browser:status-changed', { id, running });
    }
  });
}
