import { useCallback, useEffect, useState } from 'react';
import type { ProfileRuntime, ProxyWarning, InitState, CreateProfileInput } from '../main/types';
import { api, bridgeReady } from './api';
import { ProfileList } from './components/ProfileList';
import { ProfileForm } from './components/ProfileForm';
import { StartupScreen } from './components/StartupScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastContainer, type ToastItem, type ToastKind } from './components/Toast';

export default function App() {
  const [init, setInit] = useState<InitState>(
    bridgeReady
      ? { phase: 'starting', message: 'Đang khởi động…' }
      : { phase: 'error', message: 'Cầu nối preload không khả dụng (window.api undefined).' },
  );
  const [profiles, setProfiles] = useState<ProfileRuntime[]>([]);
  const [warnings, setWarnings] = useState<ProxyWarning[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ProfileRuntime | null>(null);

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

  // Track main-process init state.
  useEffect(() => {
    if (!bridgeReady) return;
    api.getInitState().then(setInit).catch(() => {});
    const unsub = api.onInitState(setInit);
    return () => { unsub(); };
  }, []);

  // Once services are ready, load data and subscribe to live status changes.
  useEffect(() => {
    if (init.phase !== 'ready') return;
    refresh().catch((e) => addToast('error', String(e instanceof Error ? e.message : e)));
    const unsub = api.onStatusChanged(({ id, running }) => {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, running } : p)));
    });
    return () => { unsub(); };
  }, [init.phase, refresh, addToast]);

  async function handleCreate(input: CreateProfileInput) {
    try {
      await api.create(input);
      setShowForm(false);
      await refresh();
      addToast('success', `Đã tạo profile “${input.name}”.`);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
    }
  }

  async function handleLaunch(id: string) {
    setBusyFor(id, true);
    try {
      await api.launch(id);
      await refresh(); // pick up captured fingerprint
    } catch (e) {
      addToast('error', `Không mở được: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyFor(id, false);
    }
  }

  async function handleStop(id: string) {
    setBusyFor(id, true);
    try {
      await api.stop(id);
      await refresh();
    } catch (e) {
      addToast('error', `Không dừng được: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyFor(id, false);
    }
  }

  async function handleDuplicate(id: string) {
    setBusyFor(id, true);
    try {
      await api.duplicate(id);
      await refresh();
      addToast('success', 'Đã nhân bản profile.');
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFor(id, false);
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    setBusyFor(target.id, true);
    try {
      await api.remove(target.id);
      await refresh();
      addToast('success', `Đã xoá “${target.name}”.`);
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyFor(target.id, false);
    }
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
            <h1 className="text-xl font-bold tracking-tight">CloakBrowser Manager</h1>
            <p className="text-xs text-slate-400">
              {profiles.length} profile · {runningCount} đang chạy
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 transition-colors"
          >
            + Tạo profile
          </button>
        </header>

        <ProfileList
          profiles={profiles}
          warnings={warnings}
          busy={busy}
          onLaunch={handleLaunch}
          onStop={handleStop}
          onDuplicate={handleDuplicate}
          onDelete={(id) => setPendingDelete(profiles.find((p) => p.id === id) ?? null)}
        />
      </div>

      {showForm && <ProfileForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />}

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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
