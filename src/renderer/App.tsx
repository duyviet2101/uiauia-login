import { useCallback, useEffect, useState } from 'react';
import type { ProfileRuntime, ProxyWarning } from '../main/types';
import { api } from './api';
import { ProfileList } from './components/ProfileList';
import { ProfileForm } from './components/ProfileForm';

export default function App() {
  const [profiles, setProfiles] = useState<ProfileRuntime[]>([]);
  const [warnings, setWarnings] = useState<ProxyWarning[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [ps, ws] = await Promise.all([api.list(), api.warnings()]);
    setProfiles(ps);
    setWarnings(ws);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const unsub = api.onStatusChanged(({ id, running }) => {
      setProfiles(prev => prev.map(p => p.id === id ? { ...p, running } : p));
    });
    return () => { unsub(); };
  }, []);

  async function handleCreate(input: Parameters<typeof api.create>[0]) {
    setError(null);
    try {
      await api.create(input);
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLaunch(id: string) {
    setError(null);
    try { await api.launch(id); } catch (e) { setError(String(e)); }
  }

  async function handleStop(id: string) {
    setError(null);
    try { await api.stop(id); } catch (e) { setError(String(e)); }
  }

  async function handleDuplicate(id: string) {
    setError(null);
    try { await api.duplicate(id); await refresh(); } catch (e) { setError(String(e)); }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Xoá profile này?`)) return;
    setError(null);
    try { await api.remove(id); await refresh(); } catch (e) { setError(String(e)); }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">CloakBrowser Manager</h1>
          <button onClick={() => setShowForm(true)} className="px-4 py-1.5 rounded-lg bg-blue-600 text-sm font-medium hover:bg-blue-500">
            + Tạo profile
          </button>
        </div>

        {error && (
          <div className="rounded bg-red-900/60 border border-red-700 text-red-200 text-sm px-3 py-2">
            {error}
          </div>
        )}

        <ProfileList
          profiles={profiles}
          warnings={warnings}
          onLaunch={handleLaunch}
          onStop={handleStop}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />

        {showForm && <ProfileForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />}
      </div>
    </div>
  );
}
