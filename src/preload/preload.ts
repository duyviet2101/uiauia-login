import { contextBridge, ipcRenderer } from 'electron';
import type { CreateProfileInput, UpdateProfileInput, ProxyConfig } from '../main/types';

const api = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  warnings: () => ipcRenderer.invoke('profiles:warnings'),
  createProfile: (input: CreateProfileInput) => ipcRenderer.invoke('profiles:create', input),
  updateProfile: (id: string, patch: UpdateProfileInput) => ipcRenderer.invoke('profiles:update', id, patch),
  duplicateProfile: (id: string) => ipcRenderer.invoke('profiles:duplicate', id),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
  launch: (id: string) => ipcRenderer.invoke('browser:launch', id),
  stop: (id: string) => ipcRenderer.invoke('browser:stop', id),
  testProxy: (proxy: ProxyConfig) => ipcRenderer.invoke('proxy:test', proxy),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => {
    const handler = (_e: unknown, payload: { id: string; running: boolean }) => cb(payload);
    ipcRenderer.on('browser:status-changed', handler);
    return () => ipcRenderer.removeListener('browser:status-changed', handler);
  },
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);
