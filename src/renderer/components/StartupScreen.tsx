import type { InitState } from '../../main/types';
import { Spinner } from './Spinner';

interface Props {
  state: InitState;
  onRetry: () => void;
}

export function StartupScreen({ state, onRetry }: Props) {
  const isError = state.phase === 'error';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm text-center space-y-5">
        <div className="flex items-center justify-center">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg">
            🛡️
          </div>
        </div>
        <h1 className="text-lg font-bold tracking-tight">CloakBrowser Manager</h1>

        {isError ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-left text-sm text-red-200">
              <p className="font-semibold mb-1">Khởi động thất bại</p>
              <p className="break-words text-red-300/90">{state.message}</p>
            </div>
            <button
              onClick={onRetry}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Thử lại
            </button>
            <p className="text-xs text-slate-500">
              Nếu lỗi tải trình duyệt, hãy kiểm tra mạng rồi khởi động lại ứng dụng.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-center text-blue-400">
              <Spinner size={28} />
            </div>
            <p className="text-sm text-slate-400">{state.message || 'Đang chuẩn bị…'}</p>
            {state.phase === 'preparing-binary' && (
              <p className="text-xs text-slate-600">
                Lần đầu chạy có thể tải ~150&nbsp;MB, vui lòng đợi.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
