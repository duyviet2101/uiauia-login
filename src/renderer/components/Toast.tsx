export type ToastKind = 'error' | 'success' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface Props {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const styles: Record<ToastKind, string> = {
  error: 'bg-red-950/90 border-red-700 text-red-100',
  success: 'bg-emerald-950/90 border-emerald-700 text-emerald-100',
  info: 'bg-slate-800/95 border-slate-600 text-slate-100',
};

const icons: Record<ToastKind, string> = {
  error: '✕',
  success: '✓',
  info: 'ℹ',
};

export function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur ${styles[t.kind]}`}
          role="status"
        >
          <span className="mt-0.5 font-bold flex-shrink-0">{icons[t.kind]}</span>
          <span className="flex-1 break-words leading-snug">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="flex-shrink-0 text-current/60 hover:text-current transition-colors"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
