import type {
  ProfileRuntime,
  CreateProfileInput,
  UpdateProfileInput,
  ProxyConfig,
  ProxyTestResult,
  ProxyWarning,
  InitState,
  UpdateStatus,
  LaunchResult,
  IdentityPreflightResult,
  FingerprintDiagnostics,
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
  getVersion: (): Promise<string> => need().getVersion(),
  openExternal: (url: string): Promise<void> => need().openExternal(url),

  update: {
    check: (): Promise<UpdateStatus> => need().update.check(),
    start: (): Promise<void> => need().update.start(),
    apply: (): Promise<void> => need().update.apply(),
    onStatus: (cb: (s: UpdateStatus) => void) => need().update.onStatus(cb),
  },

  list: (): Promise<ProfileRuntime[]> => need().listProfiles(),
  warnings: (): Promise<ProxyWarning[]> => need().warnings(),
  create: (i: CreateProfileInput) => need().createProfile(i),
  updateProfile: (id: string, p: UpdateProfileInput) => need().updateProfile(id, p),
  duplicate: (id: string) => need().duplicateProfile(id),
  remove: (id: string) => need().deleteProfile(id),
  regenerateSeed: (id: string) => need().regenerateSeed(id),
  resetIdentity: (id: string) => need().resetIdentity(id),
  preflightIdentity: (id: string): Promise<IdentityPreflightResult> => need().preflightIdentity(id),
  launch: (id: string): Promise<LaunchResult> => need().launch(id),
  forceLaunch: (id: string): Promise<LaunchResult> => need().forceLaunch(id),
  stop: (id: string) => need().stop(id),
  openUrl: (id: string, url: string) => need().openUrl(id, url),
  runDiagnostics: (id: string): Promise<FingerprintDiagnostics> => need().runDiagnostics(id),
  testProxy: (p: ProxyConfig): Promise<ProxyTestResult> => need().testProxy(p),
  onStatusChanged: (cb: (p: { id: string; running: boolean }) => void) => need().onStatusChanged(cb),
};
