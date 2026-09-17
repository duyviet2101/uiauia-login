import type { ProfileRuntime, ProfileSession, ProfileSessionStatus } from '../../main/types';

interface Props {
  profile: ProfileRuntime;
  onClose: () => void;
}

const STATUS: Record<ProfileSessionStatus, { label: string; style: string }> = {
  launching: { label: 'Đang mở', style: 'bg-blue-950 text-blue-300' },
  running: { label: 'Đang chạy', style: 'bg-emerald-950 text-emerald-300' },
  closed: { label: 'Đã đóng', style: 'bg-slate-700 text-slate-300' },
  failed: { label: 'Mở lỗi', style: 'bg-red-950 text-red-300' },
  interrupted: { label: 'Bị gián đoạn', style: 'bg-amber-950 text-amber-300' },
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('vi-VN') : '—';
}

function duration(session: ProfileSession): string {
  const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const start = new Date(session.startedAt).getTime();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút ${seconds % 60} giây`;
  const hours = Math.floor(minutes / 60);
  return `${hours} giờ ${minutes % 60} phút`;
}

export function SessionHistoryDialog({ profile, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-history-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl bg-slate-800 shadow-2xl ring-1 ring-slate-700"
      >
        <header className="flex items-start justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 id="session-history-title" className="font-semibold text-white">Lịch sử mở profile</h2>
            <p className="mt-0.5 text-xs text-slate-400">{profile.name} · {profile.sessions.length} phiên gần nhất</p>
          </div>
          <button onClick={onClose} aria-label="Đóng" className="rounded px-2 py-1 text-slate-400 hover:bg-slate-700 hover:text-white">✕</button>
        </header>

        <div className="max-h-[calc(85vh-72px)] space-y-2 overflow-y-auto p-4">
          {profile.sessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Chưa có phiên mở nào được ghi lại.</p>
          ) : profile.sessions.map((session) => {
            const status = STATUS[session.status];
            return (
              <article key={session.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${status.style}`}>{status.label}</span>
                  <span className="text-xs text-slate-400">{duration(session)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500">Bắt đầu</dt><dd className="text-slate-300">{formatDate(session.startedAt)}</dd>
                  <dt className="text-slate-500">Kết nối</dt><dd className="text-slate-300">{formatDate(session.connectedAt)}</dd>
                  <dt className="text-slate-500">Kết thúc</dt><dd className="text-slate-300">{formatDate(session.endedAt)}</dd>
                </dl>
                {session.error && (
                  <details className="mt-2 rounded bg-red-950/30 px-2 py-1.5 text-xs text-red-200">
                    <summary className="cursor-pointer select-none">Xem lỗi</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">{session.error}</pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
