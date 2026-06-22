import { useState } from 'react';
import type { ProfileRuntime, ProxyWarning } from '../../main/types';
import { FingerprintPanel } from './FingerprintPanel';
import { Spinner } from './Spinner';

interface Props {
  profiles: ProfileRuntime[];
  warnings: ProxyWarning[];
  busy: Set<string>;
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onTest: (id: string) => void;
  onDiagnostics: (id: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRegenerateSeed: (id: string) => void;
  onResetIdentity: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatLastOpened(iso: string | null): string {
  if (!iso) return 'Chưa mở lần nào';
  return `Mở gần nhất: ${new Date(iso).toLocaleString('vi-VN')}`;
}

export function ProfileList({
  profiles, warnings, busy,
  onLaunch, onStop, onTest, onDiagnostics, onEdit, onDuplicate, onRegenerateSeed, onResetIdentity, onDelete,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const warnMap = new Map<string, ProxyWarning[]>();
  for (const w of warnings) {
    const arr = warnMap.get(w.profileId) ?? [];
    arr.push(w);
    warnMap.set(w.profileId, arr);
  }

  if (!profiles.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 py-12 text-center">
        <p className="text-3xl mb-2">🗂️</p>
        <p className="text-sm text-slate-400">Chưa có profile nào.</p>
        <p className="text-xs text-slate-500 mt-1">Nhấn “+ Tạo profile” để bắt đầu.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profiles.map((p) => {
        const ws = warnMap.get(p.id) ?? [];
        const isOpen = expanded === p.id;
        const isBusy = busy.has(p.id);
        const identityDrift = p.identityLocked && !!p.resolvedIdentity?.exitIp && !!p.lastProxyCheck?.exitIp && p.resolvedIdentity.exitIp !== p.lastProxyCheck.exitIp;
        return (
          <div key={p.id} className="rounded-xl bg-slate-800 p-4 ring-1 ring-slate-700/60 transition-colors hover:ring-slate-600">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${p.running ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60' : 'bg-slate-600'}`}
                title={p.running ? 'Đang chạy' : 'Đang tắt'}
              />
              <span className="flex-1 truncate font-medium text-white">{p.name}</span>
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-300">
                {p.platform === 'macos' ? 'macOS' : 'Win'}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                  identityDrift
                    ? 'bg-red-900 text-red-200'
                    : p.identityLocked
                      ? 'bg-emerald-900 text-emerald-200'
                      : 'bg-slate-700 text-slate-300'
                }`}
                title={identityDrift ? 'Identity drift detected' : p.identityLocked ? 'Identity locked' : 'Identity not locked yet'}
              >
                {identityDrift ? 'Drift' : p.identityLocked ? 'Locked' : 'Unlocked'}
              </span>
              {ws.map((w, i) => (
                <span
                  key={i}
                  title={w.message}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${w.level === 'high' ? 'bg-red-900 text-red-200' : 'bg-amber-900 text-amber-200'}`}
                >
                  {w.level === 'high' ? '⚠ Không proxy' : '⚠ Trùng IP'}
                </span>
              ))}
            </div>

            <p className="mt-1.5 pl-5 text-xs text-slate-400">
              {p.proxy ? (
                <>
                  {p.proxy.type.toUpperCase()} {p.proxy.host}:{p.proxy.port}
                  {p.geoip && ' · geoip'}
                </>
              ) : (
                <span className="text-slate-500">Không proxy · dùng IP máy chủ</span>
              )}
              <span className="text-slate-600"> · {formatLastOpened(p.lastOpenedAt)}</span>
            </p>

            {p.visitorId && (
              <p className="mt-0.5 pl-5 text-xs text-slate-500">
                FP ID: <span className="font-mono text-slate-400">{p.visitorId.slice(0, 16)}</span>
              </p>
            )}
            {p.resolvedIdentity && (
              <p className="mt-0.5 pl-5 text-xs text-slate-500">
                Locked IP: <span className="font-mono text-slate-400">{p.resolvedIdentity.exitIp}</span>
                {p.resolvedIdentity.cloakBrowserVersion && (
                  <> · Chromium <span className="font-mono text-slate-400">{p.resolvedIdentity.cloakBrowserVersion}</span></>
                )}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2 pl-5">
              {p.running ? (
                <button
                  onClick={() => onStop(p.id)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
                >
                  {isBusy && <Spinner size={12} />}
                  {isBusy ? 'Đang dừng…' : 'Dừng'}
                </button>
              ) : (
                <button
                  onClick={() => onLaunch(p.id)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60 transition-colors"
                >
                  {isBusy && <Spinner size={12} />}
                  {isBusy ? 'Đang mở…' : 'Mở'}
                </button>
              )}
              <button
                onClick={() => onTest(p.id)}
                disabled={isBusy}
                title="Mở trang kiểm tra fingerprint trong profile này"
                className="rounded-lg bg-indigo-700 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-60 transition-colors"
              >
                Test FP ↗
              </button>
              <button
                onClick={() => onDiagnostics(p.id)}
                disabled={isBusy}
                title="Chạy probe local cho canvas/audio/font"
                className="rounded-lg bg-cyan-700 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-60 transition-colors"
              >
                Diagnostics
              </button>
              <button
                onClick={() => onEdit(p.id)}
                disabled={isBusy}
                className="rounded-lg bg-slate-600 px-3 py-1 text-xs text-white hover:bg-slate-500 disabled:opacity-60 transition-colors"
              >
                Sửa
              </button>
              <button
                onClick={() => onDuplicate(p.id)}
                disabled={isBusy}
                className="rounded-lg bg-slate-600 px-3 py-1 text-xs text-white hover:bg-slate-500 disabled:opacity-60 transition-colors"
              >
                Nhân bản
              </button>
              <button
                onClick={() => onDelete(p.id)}
                disabled={isBusy || p.running}
                title={p.running ? 'Dừng trước khi xoá' : undefined}
                className="rounded-lg bg-slate-600 px-3 py-1 text-xs text-slate-300 hover:bg-red-800 hover:text-white disabled:opacity-60 disabled:hover:bg-slate-600 disabled:hover:text-slate-300 transition-colors"
              >
                Xoá
              </button>
              <button
                onClick={() => setExpanded(isOpen ? null : p.id)}
                className="rounded-lg bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600 transition-colors"
              >
                {isOpen ? 'Ẩn fingerprint ▲' : 'Xem fingerprint ▼'}
              </button>
            </div>

            {isOpen && (
              <div className="mt-2 pl-5 text-white">
                <FingerprintPanel fingerprint={p.fingerprint} visitorId={p.visitorId} diagnostics={p.diagnostics} platform={p.platform} />
                <button
                  onClick={() => (p.identityLocked ? onResetIdentity(p.id) : onRegenerateSeed(p.id))}
                  disabled={isBusy || p.running}
                  title={p.running ? 'Dừng profile trước' : p.identityLocked ? 'Mở khoá identity để thiết lập lại fingerprint/proxy' : 'Tạo danh tính fingerprint hoàn toàn mới'}
                  className="mt-2 rounded-lg bg-slate-700 px-3 py-1 text-xs text-amber-300 hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                  {p.identityLocked ? 'Reset identity' : '🔄 Đổi seed (danh tính mới)'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
