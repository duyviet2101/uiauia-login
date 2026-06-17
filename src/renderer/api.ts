import type {
  ProfileRuntime,
  CreateProfileInput,
  UpdateProfileInput,
  ProxyConfig,
  ProxyTestResult,
  ProxyWarning,
  InitState,
} from '../main/types';

const bridge = typeof window !== 'undefined' ? window.api : undefined;

/** True when the preload contextBridge injected `window.api` successfully. */
export const bridgeReady = !!bridge;

function need() {
  if (!bridge) {
    throw new Error('Cầu nối preload chưa sẵn sàng (window.api undefined). Hãy kiểm tra preload.');
  }
  return bridge;
}

export const api = {
  getInitState: (): Promise<InitState> => need().getInitState(),
  onInitState: (cb: (s: InitState) => void) => need().onInitState(cb),

  list: (): Promise<ProfileRuntime[]> => need().listProfiles(),
  warnings: (): Promise<ProxyWarning[]> => need().warnings(),
  create: (i: CreateProfileInput) => need().createProfile(i),
  update: (id: string, p: UpdateProfileInput) => need().updateProfile(id, p),
  duplicate: (id: string) => need().duplicateProfile(id),
  remove: (id: string) => need().deleteProfile(id),
  launch: (id: string) => need().launch(id),
  stop: (id: string) => need().stop(id),
  testProxy: (p: ProxyConfig): Promise<ProxyTestResult> => need().testProxy(p),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => need().onStatusChanged(cb),
};
