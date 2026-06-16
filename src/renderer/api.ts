import type { ProfileRuntime, CreateProfileInput, UpdateProfileInput, ProxyConfig, ProxyTestResult, ProxyWarning } from '../main/types';

export const api = {
  list: (): Promise<ProfileRuntime[]> => window.api.listProfiles(),
  warnings: (): Promise<ProxyWarning[]> => window.api.warnings(),
  create: (i: CreateProfileInput) => window.api.createProfile(i),
  update: (id: string, p: UpdateProfileInput) => window.api.updateProfile(id, p),
  duplicate: (id: string) => window.api.duplicateProfile(id),
  remove: (id: string) => window.api.deleteProfile(id),
  launch: (id: string) => window.api.launch(id),
  stop: (id: string) => window.api.stop(id),
  testProxy: (p: ProxyConfig): Promise<ProxyTestResult> => window.api.testProxy(p),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => window.api.onStatusChanged(cb),
};
