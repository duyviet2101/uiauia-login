import { ipcMain, BrowserWindow } from 'electron';
import type { ProfileStore } from './store';
import type { BrowserManager } from './browser-manager';
import type { ProxyTester } from './proxy-tester';
import { proxyWarnings } from './unlinkability';
import { IdentityService } from './identity-service';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, ProfileRuntime } from './types';
import { IdentityDriftError } from './types';

export function registerIpc(
  store: ProfileStore,
  manager: BrowserManager,
  proxyTester: ProxyTester,
  identityService: IdentityService = new IdentityService(proxyTester),
) {
  const withRuntime = (): ProfileRuntime[] =>
    store.list().map((p) => ({ ...p, running: manager.isRunning(p.id) }));

  ipcMain.handle('profiles:list', () => withRuntime());
  ipcMain.handle('profiles:warnings', () => proxyWarnings(store.list()));
  ipcMain.handle('profiles:create', (_e, input: CreateProfileInput) => store.create(input));
  ipcMain.handle('profiles:update', async (_e, id: string, patch: UpdateProfileInput) => {
    await store.update(id, patch);
    await manager.refreshWindowCustomization(id);
    return store.get(id);
  });
  ipcMain.handle('profiles:duplicate', (_e, id: string) => store.duplicate(id));
  ipcMain.handle('profiles:delete', (_e, id: string) => store.remove(id));
  ipcMain.handle('profiles:regenerate-seed', (_e, id: string) => store.regenerateSeed(id));
  ipcMain.handle('profiles:reset-identity', (_e, id: string) => store.resetIdentity(id));
  ipcMain.handle('profiles:preflight-identity', (_e, id: string) => {
    const p = store.get(id);
    if (!p) throw new Error(`Profile not found: ${id}`);
    return identityService.checkLockedIdentity(p);
  });

  ipcMain.handle('browser:launch', async (_e, id: string) => {
    try {
      return await manager.launch(id);
    } catch (e) {
      if (e instanceof IdentityDriftError) {
        throw new Error(`IDENTITY_DRIFT_BLOCKED:${JSON.stringify(e.drift)}`);
      }
      throw e;
    }
  });
  ipcMain.handle('browser:force-launch', (_e, id: string) => manager.forceLaunch(id));
  ipcMain.handle('browser:stop', (_e, id: string) => manager.stop(id));
  ipcMain.handle('browser:running', () => manager.runningIds());
  ipcMain.handle('browser:open-url', (_e, id: string, url: string) => manager.openUrl(id, url));
  ipcMain.handle('browser:diagnostics', (_e, id: string) => manager.runDiagnostics(id));

  ipcMain.handle('proxy:test', (_e, proxy: ProxyConfig) => proxyTester.test(proxy));

  manager.on('status-changed', (id: string, running: boolean) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('browser:status-changed', { id, running });
    }
  });
}
