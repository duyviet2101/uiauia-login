import { useCallback, useEffect, useState } from 'react';
import type { ProfileRuntime, ProxyWarning, InitState, UpdateStatus, IdentityDrift } from '../main/types';
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
            ? { name: values.name, startUrl: values.startUrl, windowCustomization: values.windowCustomization }
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
      addToast('error', `${errPrefix}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyFor(id, false);
    }
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
      addToast('success', 'Đã mở và cập nhật IP/identity đã khoá theo môi trường hiện tại.');
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

      {pendingIdentityDrift && (
        <ConfirmDialog
          title="Identity drift blocked"
          message={`Không mở “${pendingIdentityDrift.profile.name}” vì identity đã khoá bị lệch: ${pendingIdentityDrift.drift.map((d) => `${d.field} expected ${d.expected ?? 'null'} got ${d.actual ?? 'null'}`).join('; ')}.

• “Mở & cập nhật IP”: giữ nguyên seed/fingerprint/cookie, chỉ cập nhật IP/phiên bản đã khoá theo hiện tại (dùng khi proxy chỉ đổi IP).
• “Reset identity”: xoá fingerprint đã khoá và tạo danh tính mới (chỉ dùng khi thực sự muốn đổi thiết bị).`}
          confirmLabel="Reset identity"
          danger
          tertiary={{ label: 'Mở & cập nhật IP', onClick: () => forceLaunchAcceptingIp(pendingIdentityDrift.profile) }}
          onConfirm={() => confirmResetIdentity(pendingIdentityDrift.profile)}
          onCancel={() => setPendingIdentityDrift(null)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
