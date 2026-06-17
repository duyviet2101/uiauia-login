import { useCallback, useEffect, useState } from 'react';
import type { ProfileRuntime, ProxyWarning, InitState, UpdateInfo } from '../main/types';
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
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

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
    api.checkUpdate().then(setUpdate).catch(() => {});
    const unsub = api.onStatusChanged(({ id, running }) => {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, running } : p)));
    });
    return () => { unsub(); };
  }, [init.phase, refresh, addToast]);

  function openCreate() { setEditing(null); setFormOpen(true); }
  function openEdit(id: string) {
    const p = profiles.find((x) => x.id === id) ?? null;
    setEditing(p);
    setFormOpen(true);
  }

  async function handleSubmit(values: ProfileFormValues) {
    try {
      if (editing) {
        await api.update(editing.id, values);
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

  const handleLaunch = (id: string) => withBusy(id, async () => { await api.launch(id); await refresh(); }, 'Không mở được');
  const handleStop = (id: string) => withBusy(id, async () => { await api.stop(id); await refresh(); }, 'Không dừng được');
  const handleTest = (id: string) =>
    withBusy(id, async () => { await api.openUrl(id, TEST_FP_URL); addToast('info', 'Đã mở trang kiểm tra fingerprint.'); }, 'Không mở trang test được');
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
          <button onClick={openCreate} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 transition-colors">
            + Tạo profile
          </button>
        </header>

        {update?.hasUpdate && !updateDismissed && (
          <UpdateBanner
            info={update}
            onDownload={() => update.url && api.openExternal(update.url)}
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
          onEdit={openEdit}
          onDuplicate={handleDuplicate}
          onRegenerateSeed={(id) => setPendingReseed(profiles.find((p) => p.id === id) ?? null)}
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
