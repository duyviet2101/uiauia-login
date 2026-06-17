import type { UpdateInfo } from '../../main/types';

interface Props {
  info: UpdateInfo;
  onDownload: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ info, onDownload, onDismiss }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-700 bg-blue-950/70 px-4 py-2.5 text-sm text-blue-100">
      <span className="text-lg">🎉</span>
      <span className="flex-1">
        Có bản mới <strong>{info.latest}</strong> (đang dùng {info.current}). Cài đè lên app cũ — dữ liệu được giữ nguyên.
      </span>
      <button
        onClick={onDownload}
        className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
      >
        Tải về
      </button>
      <button onClick={onDismiss} className="text-blue-300/70 hover:text-blue-100 transition-colors" aria-label="Đóng">
        ✕
      </button>
    </div>
  );
}
