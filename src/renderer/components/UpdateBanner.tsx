import type { UpdateStatus } from '../../main/types';

interface Props {
  status: UpdateStatus;
  onStart: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

const BTN = 'rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors';

export function UpdateBanner({ status, onStart, onApply, onDismiss }: Props) {
  const { state, latest, current, percent, canAutoInstall, error } = status;

  let body: React.ReactNode = null;
  let action: React.ReactNode = null;

  if (state === 'available') {
    body = <>Có bản mới <strong>{latest}</strong> (đang dùng {current}).</>;
    action = <button onClick={onStart} className={BTN}>Tải về</button>;
  } else if (state === 'downloading') {
    body = <>Đang tải bản mới… <strong>{percent ?? 0}%</strong></>;
  } else if (state === 'downloaded') {
    body = canAutoInstall
      ? <>Đã tải xong. Cài đè lên app cũ — dữ liệu giữ nguyên.</>
      : <>Đã tải xong. Mở trình cài đặt rồi kéo app vào thư mục Applications.</>;
    action = <button onClick={onApply} className={BTN}>{canAutoInstall ? 'Cài & khởi động lại' : 'Mở trình cài đặt'}</button>;
  } else if (state === 'error') {
    body = <>Không cập nhật được: {error}</>;
  } else {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-700 bg-blue-950/70 px-4 py-2.5 text-sm text-blue-100">
      <span className="text-lg">🎉</span>
      <span className="flex-1">{body}</span>
      {action}
      <button onClick={onDismiss} className="text-blue-300/70 hover:text-blue-100 transition-colors" aria-label="Đóng">✕</button>
    </div>
  );
}
