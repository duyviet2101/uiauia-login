import type { Fingerprint, FingerprintDiagnostics, FingerprintPlatform } from '../../main/types';

interface Props {
  fingerprint: Fingerprint | null;
  visitorId?: string | null;
  diagnostics?: FingerprintDiagnostics | null;
  platform?: FingerprintPlatform;
}

export function FingerprintPanel({ fingerprint, visitorId, diagnostics, platform }: Props) {
  if (!fingerprint) {
    return (
      <p className="text-xs text-gray-400 italic">Chưa có dữ liệu — khởi động profile để ghi nhận fingerprint.</p>
    );
  }
  const rows: [string, string][] = [
    ['Spoof OS', platform === 'macos' ? 'macOS' : 'Windows'],
    ['FingerprintJS ID', visitorId ?? 'chưa đo'],
    ['User Agent', fingerprint.userAgent],
    ['Platform', fingerprint.platform],
    ['CPU cores', String(fingerprint.hardwareConcurrency)],
    ['Device memory', fingerprint.deviceMemory != null ? `${fingerprint.deviceMemory} GB` : 'N/A'],
    ['Languages', fingerprint.languages.join(', ')],
    ['Screen', `${fingerprint.screen.width}×${fingerprint.screen.height} @${fingerprint.screen.colorDepth}bit`],
    ['DPR', String(fingerprint.devicePixelRatio)],
    ['WebGL vendor', fingerprint.webglVendor ?? 'N/A'],
    ['WebGL renderer', fingerprint.webglRenderer ?? 'N/A'],
    ['Timezone', fingerprint.timezone],
    ['Webdriver', fingerprint.webdriver ? 'YES ⚠' : 'no'],
  ];
  return (
    <div className="mt-2 space-y-3">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-700">
              <td className="pr-3 py-1 text-gray-400 font-medium whitespace-nowrap align-top">{k}</td>
              <td className="py-1 break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {diagnostics ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-slate-200">Local diagnostics</span>
            <span className="text-[11px] text-slate-500">{new Date(diagnostics.capturedAt).toLocaleString('vi-VN')}</span>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            <div className="text-slate-400">Canvas: <span className="font-mono text-slate-200">{diagnostics.canvasHash}</span></div>
            <div className="text-slate-400">Audio: <span className="font-mono text-slate-200">{diagnostics.audioHash ?? 'N/A'}</span></div>
            <div className="text-slate-400">Fonts: <span className="font-mono text-slate-200">{diagnostics.fontHash}</span></div>
            <div className="text-slate-400">Available fonts: <span className="font-mono text-slate-200">{diagnostics.fontsAvailable}/{diagnostics.fontsTotal}</span></div>
          </div>
          <p className="mt-2 break-words text-[11px] text-slate-500">
            {(diagnostics.fonts ?? []).filter((f) => f.available).map((f) => f.family).join(', ') || 'No candidate fonts detected'}
          </p>
          {/* nonStandardFonts is absent on diagnostics captured by older builds — guard it. */}
          {(diagnostics.nonStandardFonts ?? []).length > 0 && (
            <p className="mt-2 rounded border border-red-700/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
              ⚠ {diagnostics.nonStandardFonts!.length} font người dùng cài bị lộ giống nhau ở mọi profile:{' '}
              <span className="font-mono">{diagnostics.nonStandardFonts!.join(', ')}</span>. Gỡ khỏi Windows, hoặc dùng máy sạch font cho tài khoản quan trọng.
            </p>
          )}
          {(diagnostics.warnings ?? []).filter((w) => !w.includes('leak identically')).length > 0 && (
            <p className="mt-2 text-[11px] text-amber-300">
              {(diagnostics.warnings ?? []).filter((w) => !w.includes('leak identically')).join(' · ')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Chưa chạy local diagnostics.</p>
      )}
    </div>
  );
}
