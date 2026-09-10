import { useCallback, useEffect, useState } from 'react';
import type { ProfileRuntime, ProxyWarning, InitState, UpdateStatus, IdentityDrift } from '../main/types';
import type { EngineInfo } from '../main/engine-info';
import { api, bridgeReady } from './api';
import { ProfileList } from './components/ProfileList';
import { ProfileForm, type ProfileFormValues } from './components/ProfileForm';
import { StartupScreen } from './components/StartupScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { UpdateBanner } from './components/UpdateBanner';
import { ToastContainer, type ToastItem, type ToastKind } from './components/Toast';

const TEST_FP_URL = 'https://browserleaks.com/canvas';

export default function App() {
  const [init, setInit] = useState<InitState>(
    bridgeReady
      ? { phase: 'starting', message: 'Đang khởi động…' }
      : { phase: 'error', message: 'Cầu nối preload không khả dụng (window.api undefined).' },
  );
  const [profiles, setProfiles] = useState<ProfileRuntime[]>([]);
  const [warnings, setWarnings] = useState<ProxyWarning[]>([]);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileRuntime | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ProfileRuntime | null>(null);
  const [pendingReseed, setPendingReseed] = useState<ProfileRuntime | null>(null);
  const [pendingIdentityReset, setPendingIdentityReset] = useState<ProfileRuntime | null>(null);
  const [pendingIdentityDrift, setPendingIdentityDrift] = useState<{ profile: ProfileRuntime; drift: IdentityDrift[] } | null>(null);
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4000);
    },
    [dismissToast],
  );

  const setBusyFor = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const [ps, ws] = await Promise.all([api.list(), api.warnings()]);
    setProfiles(ps);
    setWarnings(ws);
  }, []);

  useEffect(() => {
    if (!bridgeReady) return;
    api.getInitState().then(setInit).catch(() => {});
    const unsub = api.onInitState(setInit);
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (init.phase !== 'ready') return;
    refresh().catch((e) => addToast('error', String(e instanceof Error ? e.message : e)));
    api.getVersion().then(setVersion).catch(() => {});
    api.engineInfo().then(setEngine).catch(() => {});
    const unsub = api.onStatusChanged(({ id, running }) => {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, running } : p)));
    });
    return () => { unsub(); };
  }, [init.phase, refresh, addToast]);

  useEffect(() => {
    const off = api.update.onStatus(setUpdate);
    api.update.check().catch(() => {});
    return () => { off(); };
  }, []);

  const handleCheckUpdate = async () => {
    setUpdateDismissed(false);
    setCheckingUpdate(true);
    try {
      const s = await api.update.check();
      if (s?.state === 'up-to-date') addToast('info', 'Đang dùng bản mới nhất.');
    } catch {
      /* lỗi sẽ hiện qua banner state='error' (broadcast) */
    } finally {
      setCheckingUpdate(false);
    }
  };

  function openCreate() { setEditing(null); setFormOpen(true); }
  function openEdit(id: string) {
    const p = profiles.find((x) => x.id === id) ?? null;
    setEditing(p);
    setFormOpen(true);
  }

  async function handleSubmit(values: ProfileFormValues) {
    try {
      if (editing) {
        await api.updateProfile(
          editing.id,
          editing.identityLocked
            ? {
                name: values.name,
                startUrl: values.startUrl,
                windowCustomization: values.windowCustomization,
                blockGeolocation: values.blockGeolocation,
                doNotTrack: values.doNotTrack,
              }
            : values,
        );
        addToast('success', `Đã lưu “${values.name}”.`);
      } else {
        await api.create(values);
        addToast('success', `Đã tạo profile “${values.name}”.`);
      }
      setFormOpen(false);
      setEditing(null);
      await refresh();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
    }
  }

  async function withBusy(id: string, fn: () => Promise<void>, errPrefix: string) {
    setBusyFor(id, true);
    try {
      await fn();
    } catch (e) {
      // Every launch path funnels through here, so the preflight block is
      // translated once rather than in each caller.
      const blocked = parsePreflightBlock(e) ?? parseEngineBlock(e);
      if (blocked) addToast('error', blocked);
      else addToast('error', `${errPrefix}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyFor(id, false);
    }
  }

  /**
   * A launch stopped before Chromium started, because the profile would have
   * restored its previous session over a proxy that did not answer. There is no
   * "open anyway" to offer: the tabs replay by themselves at launch, so the only
   * choices are fix the proxy or remove it from the profile.
   */
  /** The binary on disk is not the one the app was about to record. */
  function parseEngineBlock(e: unknown): string | null {
    const msg = e instanceof Error ? e.message : String(e);
    const marker = 'ENGINE_MISMATCH_BLOCKED:';
    const idx = msg.indexOf(marker);
    if (idx === -1) return null;
    try {
      const problems = JSON.parse(msg.slice(idx + marker.length)) as { message: string }[];
      return `Chưa mở profile — engine không khớp: ${problems.map((p) => p.message).join(' · ')}`;
    } catch {
      return 'Chưa mở profile — engine đang chạy không khớp với bản app ghi nhận.';
    }
  }

  function parsePreflightBlock(e: unknown): string | null {
    const msg = e instanceof Error ? e.message : String(e);
    const marker = 'PROXY_PREFLIGHT_BLOCKED:';
    const idx = msg.indexOf(marker);
    if (idx === -1) return null;
    let reason = 'proxy không phản hồi';
    try {
      const parsed = JSON.parse(msg.slice(idx + marker.length)) as { reason?: string };
      if (parsed.reason) reason = parsed.reason;
    } catch { /* keep the generic reason */ }
    return `Chưa mở profile: ${reason}. Profile này có phiên cũ sẽ tự khôi phục khi mở, `
      + 'nên phải xác minh proxy trước. Sửa proxy rồi thử lại, hoặc bỏ proxy khỏi profile.';
  }

  function parseIdentityDriftError(e: unknown): IdentityDrift[] | null {
    const msg = e instanceof Error ? e.message : String(e);
    const marker = 'IDENTITY_DRIFT_BLOCKED:';
    const idx = msg.indexOf(marker);
    if (idx === -1) return null;
    try {
      return JSON.parse(msg.slice(idx + marker.length)) as IdentityDrift[];
    } catch {
      return [];
    }
  }

  const handleLaunch = (id: string) => withBusy(id, async () => {
    // Pre-launch proxy gate: never open the browser on a dead/wrong proxy.
    const target = profiles.find((p) => p.id === id);
    if (target?.proxy) {
      addToast('info', 'Đang test proxy…');
      const pre = await api.precheckProxy(id);
      if (!pre.ok) {
        addToast('error', `Proxy không hoạt động: ${pre.error ?? 'không xác định'}. Hãy thử lại.`);
        return;
      }
      addToast('success', 'Proxy hoạt động.');
    }
    try {
      const result = await api.launch(id);
      if (result.lockedNow) addToast('success', 'Identity locked for this profile.');
      await refresh();
    } catch (e) {
      const drift = parseIdentityDriftError(e);
      if (drift) {
        const profile = profiles.find((p) => p.id === id);
        if (profile) setPendingIdentityDrift({ profile, drift });
        else addToast('error', 'Identity drift blocked.');
        return;
      }
      throw e;
    }
  }, 'Không mở được');
  /** Adopt the latest reading as the profile's baseline. Explicit only — the
   *  app never does this on its own when a fingerprint changes. */
  const handleAcceptBaseline = (id: string) =>
    withBusy(id, async () => {
      const baseline = await api.acceptBaseline(id);
      await refresh();
      addToast('success', `Đã ghi baseline mới (engine ${baseline.engineVersion}).`);
    }, 'Không ghi được baseline');
  const handleStop = (id: string) => withBusy(id, async () => { await api.stop(id); await refresh(); }, 'Không dừng được');
  const handleTest = (id: string) =>
    withBusy(id, async () => { await api.openUrl(id, TEST_FP_URL); addToast('info', 'Đã mở trang kiểm tra fingerprint.'); }, 'Không mở trang test được');
  const handleDiagnostics = (id: string) =>
    withBusy(id, async () => {
      const diagnostics = await api.runDiagnostics(id);
      await refresh();
      addToast('success', `Diagnostics OK · fonts ${diagnostics.fontsAvailable}/${diagnostics.fontsTotal}`);
    }, 'Không chạy diagnostics được');
  const handleDuplicate = (id: string) =>
    withBusy(id, async () => { await api.duplicate(id); await refresh(); addToast('success', 'Đã nhân bản profile.'); }, 'Lỗi nhân bản');

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    await withBusy(target.id, async () => {
      await api.remove(target.id);
      await refresh();
      addToast('success', `Đã xoá “${target.name}”.`);
    }, 'Lỗi xoá');
  }

  async function confirmReseed() {
    const target = pendingReseed;
    if (!target) return;
    setPendingReseed(null);
    await withBusy(target.id, async () => {
      await api.regenerateSeed(target.id);
      await refresh();
      addToast('success', 'Đã tạo danh tính mới. Mở lại profile để ghi nhận fingerprint mới.');
    }, 'Lỗi đổi seed');
  }

  async function forceLaunchAcceptingIp(target: ProfileRuntime | null) {
    if (!target) return;
    setPendingIdentityDrift(null);
    await withBusy(target.id, async () => {
      await api.forceLaunch(target.id);
      await refresh();
      addToast('success', 'Đã mở và cập nhật IP đã khoá. Engine vẫn đúng bản đã khoá — nếu engine đã đổi thì thao tác này bị chặn, không mở âm thầm.');
    }, 'Không mở được');
  }

  /** Explicit, separate decision from accepting a rotated IP: re-baseline the
   *  locked identity onto the engine that is installed now, then open. */
  async function forceLaunchAcceptingEngine(target: ProfileRuntime | null) {
    if (!target) return;
    setPendingIdentityDrift(null);
    await withBusy(target.id, async () => {
      await api.forceLaunch(target.id, { acceptEngine: true });
      await refresh();
      addToast('success', 'Đã chấp nhận engine mới cho identity đã khoá và mở profile.');
    }, 'Không mở được');
  }

  async function confirmResetIdentity(target: ProfileRuntime | null) {
    if (!target) return;
    setPendingIdentityReset(null);
    setPendingIdentityDrift(null);
    await withBusy(target.id, async () => {
      await api.resetIdentity(target.id);
      await refresh();
      addToast('success', 'Identity đã được reset. Lần mở kế tiếp với proxy hợp lệ sẽ khoá identity mới.');
    }, 'Lỗi reset identity');
  }

  if (init.phase !== 'ready') {
    return <StartupScreen state={init} onRetry={() => window.location.reload()} />;
  }

  const runningCount = profiles.filter((p) => p.running).length;

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        {/* Shown only when the binary on disk disagrees with the version the app
            records against locked identities. Silence here means verified, not
            unchecked. */}
        {engine && engine.problems.length > 0 && (
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-xs text-amber-200">
            <div className="font-medium">Engine chưa khớp</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {engine.problems.map((problem) => <li key={problem.kind}>{problem.message}</li>)}
            </ul>
            <p className="mt-1 text-[11px] text-amber-300/80">
              App <span className="font-mono">không</span> tự tải hay đổi engine. Xem docs/TECHNICAL.md §6.2.
            </p>
          </div>
        )}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              CloakBrowser Manager
              {version && <span className="ml-2 align-middle text-xs font-normal text-slate-500">v{version}</span>}
            </h1>
            <p className="text-xs text-slate-400">{profiles.length} profile · {runningCount} đang chạy</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCheckUpdate} disabled={checkingUpdate} className="rounded-lg border border-slate-600 px-4 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors disabled:opacity-50">
              {checkingUpdate ? 'Đang kiểm tra…' : 'Kiểm tra cập nhật'}
            </button>
            <button onClick={openCreate} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 transition-colors">
              + Tạo profile
            </button>
          </div>
        </header>

        {update && !updateDismissed && ['available', 'downloading', 'downloaded', 'error'].includes(update.state) && (
          <UpdateBanner
            status={update}
            onStart={() => { void api.update.start(); }}
            onApply={() => { void api.update.apply(); }}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}

        <ProfileList
          profiles={profiles}
          warnings={warnings}
          busy={busy}
          onLaunch={handleLaunch}
          onStop={handleStop}
          onTest={handleTest}
          onDiagnostics={handleDiagnostics}
          onEdit={openEdit}
          onDuplicate={handleDuplicate}
          onRegenerateSeed={(id) => setPendingReseed(profiles.find((p) => p.id === id) ?? null)}
          onResetIdentity={(id) => setPendingIdentityReset(profiles.find((p) => p.id === id) ?? null)}
          onAcceptBaseline={handleAcceptBaseline}
          onDelete={(id) => setPendingDelete(profiles.find((p) => p.id === id) ?? null)}
        />
      </div>

      {formOpen && (
        <ProfileForm
          initial={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Xoá profile"
          message={`Xoá “${pendingDelete.name}”? Toàn bộ dữ liệu phiên (cookie, đăng nhập) sẽ mất vĩnh viễn.`}
          confirmLabel="Xoá"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingReseed && (
        <ConfirmDialog
          title="Đổi seed fingerprint"
          message={`Tạo danh tính fingerprint hoàn toàn mới cho “${pendingReseed.name}”? Fingerprint cũ sẽ bị xoá và đo lại ở lần mở kế tiếp.`}
          confirmLabel="Đổi seed"
          danger
          onConfirm={confirmReseed}
          onCancel={() => setPendingReseed(null)}
        />
      )}

      {pendingIdentityReset && (
        <ConfirmDialog
          title="Reset identity"
          message={`Reset identity cho “${pendingIdentityReset.name}”? Fingerprint snapshot và lock hiện tại sẽ bị xoá, nhưng cookie và dữ liệu phiên vẫn được giữ.`}
          confirmLabel="Reset identity"
          danger
          onConfirm={() => confirmResetIdentity(pendingIdentityReset)}
          onCancel={() => setPendingIdentityReset(null)}
        />
      )}

      {pendingIdentityDrift && (() => {
        const engineDrift = pendingIdentityDrift.drift.find((d) => d.field === 'cloakBrowserVersion');
        const lines = [
          `Không mở “${pendingIdentityDrift.profile.name}” vì identity đã khoá bị lệch: ${pendingIdentityDrift.drift.map((d) => `${d.field} expected ${d.expected ?? 'null'} got ${d.actual ?? 'null'}`).join('; ')}.`,
          '',
          '• “Mở & cập nhật IP”: giữ nguyên seed/fingerprint/cookie và GIỮ NGUYÊN phiên bản engine đã khoá, chỉ cập nhật IP (dùng khi proxy chỉ đổi IP).',
        ];
        if (engineDrift) {
          lines.push(
            `• “Chấp nhận engine mới”: identity đang khoá ở engine ${engineDrift.expected ?? 'n/a'} nhưng máy đang chạy ${engineDrift.actual ?? 'n/a'}. Đổi engine làm đổi fingerprint mà site nhìn thấy, nên đây là quyết định riêng — chỉ chọn khi bạn chủ động muốn nâng.`,
          );
        }
        lines.push('• “Reset identity”: xoá fingerprint đã khoá và tạo danh tính mới (chỉ dùng khi thực sự muốn đổi thiết bị).');
        return (
          <ConfirmDialog
            title="Identity drift blocked"
            message={lines.join('\n')}
            confirmLabel="Reset identity"
            danger
            tertiary={{ label: 'Mở & cập nhật IP', onClick: () => forceLaunchAcceptingIp(pendingIdentityDrift.profile) }}
            secondary={engineDrift ? { label: 'Chấp nhận engine mới', onClick: () => forceLaunchAcceptingEngine(pendingIdentityDrift.profile) } : undefined}
            onConfirm={() => confirmResetIdentity(pendingIdentityDrift.profile)}
            onCancel={() => setPendingIdentityDrift(null)}
          />
        );
      })()}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
