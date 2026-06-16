import { useState } from 'react';
import type { ProfileRuntime, ProxyWarning } from '../../main/types';
import { FingerprintPanel } from './FingerprintPanel';

interface Props {
  profiles: ProfileRuntime[];
  warnings: ProxyWarning[];
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ProfileList({ profiles, warnings, onLaunch, onStop, onDuplicate, onDelete }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const warnMap = new Map<string, ProxyWarning[]>();
  for (const w of warnings) (warnMap.get(w.profileId) ?? warnMap.set(w.profileId, []).get(w.profileId)!).push(w);

  if (!profiles.length) return (
    <p className="text-gray-400 text-sm text-center py-8">Chưa có profile. Tạo mới để bắt đầu.</p>
  );

  return (
    <div className="space-y-3">
      {profiles.map(p => {
        const ws = warnMap.get(p.id) ?? [];
        const isOpen = expanded === p.id;
        return (
          <div key={p.id} className="rounded-lg bg-gray-800 p-4 space-y-2">
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.running ? 'bg-green-400' : 'bg-gray-500'}`} />
              <span className="font-medium text-white flex-1 truncate">{p.name}</span>
              {ws.map((w, i) => (
                <span key={i} className={`text-xs px-1.5 py-0.5 rounded font-medium ${w.level === 'high' ? 'bg-red-700 text-red-100' : 'bg-yellow-700 text-yellow-100'}`}>
                  {w.level === 'high' ? '⚠ No proxy' : '⚠ Shared proxy'}
                </span>
              ))}
            </div>

            {p.proxy && (
              <p className="text-xs text-gray-400 pl-5">
                {p.proxy.type.toUpperCase()} {p.proxy.host}:{p.proxy.port}
                {p.geoip && ' · geoip'}
              </p>
            )}

            <div className="flex gap-2 pl-5 flex-wrap">
              {p.running
                ? <button onClick={() => onStop(p.id)} className="px-3 py-1 rounded bg-red-700 text-xs text-white hover:bg-red-600 font-medium">Stop</button>
                : <button onClick={() => onLaunch(p.id)} className="px-3 py-1 rounded bg-green-700 text-xs text-white hover:bg-green-600 font-medium">Launch</button>
              }
              <button onClick={() => onDuplicate(p.id)} className="px-3 py-1 rounded bg-gray-600 text-xs text-white hover:bg-gray-500">Nhân bản</button>
              <button onClick={() => onDelete(p.id)} className="px-3 py-1 rounded bg-gray-600 text-xs text-gray-300 hover:bg-red-800 hover:text-white">Xoá</button>
              <button onClick={() => setExpanded(isOpen ? null : p.id)} className="px-3 py-1 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600">
                {isOpen ? 'Ẩn fingerprint ▲' : 'Xem fingerprint ▼'}
              </button>
            </div>

            {isOpen && (
              <div className="pl-5 text-white">
                <FingerprintPanel fingerprint={p.fingerprint} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
