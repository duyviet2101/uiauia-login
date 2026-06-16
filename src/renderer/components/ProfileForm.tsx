import { useState } from 'react';
import type { CreateProfileInput, ProxyConfig } from '../../main/types';

interface Props { onSubmit: (input: CreateProfileInput) => void; onCancel: () => void; }

export function ProfileForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [useProxy, setUseProxy] = useState(false);
  const [proxyType, setProxyType] = useState<'http' | 'socks5'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const proxy: ProxyConfig | null = useProxy && host && port
      ? { type: proxyType, host, port: Number(port), username: username || undefined, password: password || undefined }
      : null;
    onSubmit({ name, proxy, geoip: !!proxy });
  }

  const inputCls = 'w-full rounded bg-gray-700 px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold text-white">Tạo profile mới</h2>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Tên profile *</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="Facebook acc 1" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={useProxy} onChange={e => setUseProxy(e.target.checked)} />
          Dùng proxy
        </label>

        {useProxy && (
          <div className="space-y-2 pl-2 border-l-2 border-blue-600">
            <div className="flex gap-2">
              <div className="w-24">
                <label className="block text-xs text-gray-400 mb-1">Loại</label>
                <select className={inputCls} value={proxyType} onChange={e => setProxyType(e.target.value as 'http' | 'socks5')}>
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Host *</label>
                <input className={inputCls} value={host} onChange={e => setHost(e.target.value)} placeholder="1.2.3.4" required={useProxy} />
              </div>
              <div className="w-20">
                <label className="block text-xs text-gray-400 mb-1">Port *</label>
                <input className={inputCls} type="number" value={port} onChange={e => setPort(e.target.value)} placeholder="1080" required={useProxy} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} placeholder="(tuỳ chọn)" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Password</label>
                <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="(tuỳ chọn)" />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded bg-gray-600 text-sm text-white hover:bg-gray-500">Huỷ</button>
          <button type="submit" className="px-4 py-1.5 rounded bg-blue-600 text-sm text-white hover:bg-blue-500 font-medium">Tạo</button>
        </div>
      </form>
    </div>
  );
}
