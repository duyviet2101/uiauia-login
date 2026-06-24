import { contextBridge, ipcRenderer } from 'electron';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig, InitState, UpdateStatus } from '../main/types';

const api = {
  getInitState: (): Promise<InitState> => ipcRenderer.invoke('app:get-init-state'),
  onInitState: (cb: (s: InitState) => void) => {
    const handler = (_e: unknown, s: InitState) => cb(s);
    ipcRenderer.on('app:init-state', handler);
    return () => ipcRenderer.removeListener('app:init-state', handler);
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),

  update: {
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    start: (): Promise<void> => ipcRenderer.invoke('update:start'),
    apply: (): Promise<void> => ipcRenderer.invoke('update:apply'),
    onStatus: (cb: (s: UpdateStatus) => void) => {
      const handler = (_e: unknown, s: UpdateStatus) => cb(s);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  warnings: () => ipcRenderer.invoke('profiles:warnings'),
  createProfile: (input: CreateProfileInput) => ipcRenderer.invoke('profiles:create', input),
  updateProfile: (id: string, patch: UpdateProfileInput) => ipcRenderer.invoke('profiles:update', id, patch),
  duplicateProfile: (id: string) => ipcRenderer.invoke('profiles:duplicate', id),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
  regenerateSeed: (id: string) => ipcRenderer.invoke('profiles:regenerate-seed', id),
  resetIdentity: (id: string) => ipcRenderer.invoke('profiles:reset-identity', id),
  preflightIdentity: (id: string) => ipcRenderer.invoke('profiles:preflight-identity', id),
  precheckProxy: (id: string) => ipcRenderer.invoke('browser:precheck-proxy', id),
  launch: (id: string) => ipcRenderer.invoke('browser:launch', id),
  forceLaunch: (id: string) => ipcRenderer.invoke('browser:force-launch', id),
  stop: (id: string) => ipcRenderer.invoke('browser:stop', id),
  openUrl: (id: string, url: string) => ipcRenderer.invoke('browser:open-url', id, url),
  runDiagnostics: (id: string) => ipcRenderer.invoke('browser:diagnostics', id),
  testProxy: (proxy: ProxyConfig) => ipcRenderer.invoke('proxy:test', proxy),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => {
    const handler = (_e: unknown, payload: { id: string; running: boolean }) => cb(payload);
    ipcRenderer.on('browser:status-changed', handler);
    return () => ipcRenderer.removeListener('browser:status-changed', handler);
  },
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
