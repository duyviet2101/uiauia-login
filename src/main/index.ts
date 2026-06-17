import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { ensureBinary, binaryInfo } from 'cloakbrowser';
import { ProfileStore } from './store';
import { BrowserManager } from './browser-manager';
import { ProxyTester } from './proxy-tester';
import { registerIpc } from './ipc';
import { clearQuarantine } from './quarantine';

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  await ensureBinary();
  try {
    const info = binaryInfo();
    await clearQuarantine(info.binaryPath);
  } catch { /* best-effort */ }

  const store = new ProfileStore(app.getPath('userData'));
  await store.init();
  const manager = new BrowserManager(store);
  const proxyTester = new ProxyTester();
  registerIpc(store, manager, proxyTester);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
