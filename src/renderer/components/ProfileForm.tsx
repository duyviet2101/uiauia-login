import { useState } from 'react';
import type { CreateProfileInput, ProxyConfig, ProxyTestResult } from '../../main/types';
import { api } from '../api';
import { Spinner } from './Spinner';

interface Props {
  onSubmit: (input: CreateProfileInput) => Promise<void> | void;
  onCancel: () => void;
}

const inputCls =
  'w-full rounded-lg bg-slate-700 px-2.5 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/70';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

export function ProfileForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [useProxy, setUseProxy] = useState(false);
  const [proxyType, setProxyType] = useState<'http' | 'socks5'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);

  function buildProxy(): ProxyConfig | null {
    if (!useProxy || !host || !port) return null;
    return {
      type: proxyType,
      host: host.trim(),
      port: Number(port),
      username: username || undefined,
      password: password || undefined,
    };
  }

  async function handleTestProxy() {
    const proxy = buildProxy();
    if (!proxy) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testProxy(proxy));
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), proxy: buildProxy(), geoip: useProxy });
    } finally {
      setSubmitting(false);
    }
  }

  const canTest = useProxy && !!host && !!port && !testing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl bg-slate-800 p-6 shadow-2xl ring-1 ring-slate-700"
      >
        <h2 className="text-lg font-semibold text-white">Tạo profile mới</h2>

        <div>
          <label className={labelCls}>Tên profile *</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Facebook acc 1"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-blue-500"
            checked={useProxy}
            onChange={(e) => {
              setUseProxy(e.target.checked);
              setTestResult(null);
            }}
          />
          Dùng proxy (khuyên dùng để chống liên kết IP)
        </label>

        {useProxy && (
          <div className="space-y-3 rounded-lg border-l-2 border-blue-600 bg-slate-900/40 p-3">
            <div className="flex gap-2">
              <div className="w-24">
                <label className={labelCls}>Loại</label>
                <select
                  className={inputCls}
                  value={proxyType}
                  onChange={(e) => setProxyType(e.target.value as 'http' | 'socks5')}
                >
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div className="flex-1">
                <label className={labelCls}>Host *</label>
                <input
                  className={inputCls}
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="1.2.3.4"
                  required={useProxy}
                />
              </div>
              <div className="w-20">
                <label className={labelCls}>Port *</label>
                <input
                  className={inputCls}
                  type="number"
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="1080"
                  required={useProxy}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>Username</label>
                <input
                  className={inputCls}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="(tuỳ chọn)"
                />
              </div>
              <div className="flex-1">
                <label className={labelCls}>Password</label>
                <input
                  className={inputCls}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="(tuỳ chọn)"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestProxy}
                disabled={!canTest}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testing && <Spinner size={12} />}
                {testing ? 'Đang kiểm tra…' : 'Test proxy'}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.ok
                    ? `OK · IP ${testResult.ip} · ${testResult.latencyMs}ms`
                    : `Lỗi: ${testResult.error}`}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg bg-slate-600 px-4 py-1.5 text-sm text-white hover:bg-slate-500 transition-colors"
          >
            Huỷ
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Spinner size={12} />}
            {submitting ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}
