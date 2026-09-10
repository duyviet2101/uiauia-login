import { ipcMain, BrowserWindow } from 'electron';
import type { ProfileStore } from './store';
import type { BrowserManager } from './browser-manager';
import type { ProxyTester } from './proxy-tester';
import { proxyWarnings } from './unlinkability';
import { profileHealth } from './profile-health';
import { IdentityService } from './identity-service';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, ProfileRuntime } from './types';
import { IdentityDriftError, ProxyPreflightError } from './types';

export function registerIpc(
  store: ProfileStore,
  manager: BrowserManager,
  proxyTester: ProxyTester,
  identityService: IdentityService = new IdentityService(proxyTester),
) {
  const withRuntime = (): ProfileRuntime[] =>
    store.list().map((p) => ({ ...p, running: manager.isRunning(p.id), health: profileHealth(p) }));

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

  // Electron flattens a thrown Error to its message across IPC, so both blocking
  // outcomes are re-encoded as a marker the renderer can parse back.
  const rethrowBlocked = (e: unknown): never => {
    if (e instanceof IdentityDriftError) {
      throw new Error(`IDENTITY_DRIFT_BLOCKED:${JSON.stringify(e.drift)}`);
    }
    if (e instanceof ProxyPreflightError) {
      throw new Error(`PROXY_PREFLIGHT_BLOCKED:${JSON.stringify({ reason: e.reason, snapshot: e.snapshot })}`);
    }
    throw e;
  };

  ipcMain.handle('browser:launch', async (_e, id: string) => {
    try {
      return await manager.launch(id);
    } catch (e) {
      return rethrowBlocked(e);
    }
  });
  ipcMain.handle('browser:precheck-proxy', (_e, id: string) => manager.precheckProxy(id));
  ipcMain.handle('browser:force-launch', async (_e, id: string, opts?: { acceptEngine?: boolean }) => {
    try {
      return await manager.forceLaunch(id, opts ?? {});
    } catch (e) {
      // A forced launch accepts drift, but it still restores the session — so it
      // can still be stopped by the proxy gate.
      return rethrowBlocked(e);
    }
  });
  ipcMain.handle('profiles:accept-engine', (_e, id: string) => manager.acceptEngineVersion(id));
  ipcMain.handle('profiles:accept-baseline', (_e, id: string) => manager.acceptCurrentFingerprint(id));
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
