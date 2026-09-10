import type {
  Fingerprint, FingerprintDiagnostics, FingerprintPlatform, ProfileHealth, ProfileHealthState,
} from '../../main/types';

interface Props {
  /** The ACCEPTED baseline — what this profile is supposed to look like. */
  fingerprint: Fingerprint | null;
  visitorId?: string | null;
  diagnostics?: FingerprintDiagnostics | null;
  platform?: FingerprintPlatform;
  health?: ProfileHealth;
  onAcceptBaseline?: () => void;
  acceptDisabled?: boolean;
}

const HEALTH_LABEL: Record<ProfileHealthState, string> = {
  stable: 'Ổn định',
  changed: 'Có thay đổi cần xem',
  insufficient: 'Chưa đủ dữ liệu',
  'check-failed': 'Phép kiểm tra thất bại',
};

// No colour implies a score. `changed` is amber because it needs a human, not
// because it is "70% bad"; `check-failed` is slate because a failed measurement
// says nothing at all about the profile.
const HEALTH_STYLE: Record<ProfileHealthState, string> = {
  stable: 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
  changed: 'border-amber-700/60 bg-amber-950/40 text-amber-300',
  insufficient: 'border-slate-700 bg-slate-900/60 text-slate-400',
  'check-failed': 'border-slate-600 bg-slate-900/60 text-slate-300',
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('vi-VN') : '—';
}

function HealthSection({ health, onAcceptBaseline, acceptDisabled }: {
  health: ProfileHealth;
  onAcceptBaseline?: () => void;
  acceptDisabled?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 text-xs ${HEALTH_STYLE[health.state]}`}>
      <div className="mb-1 font-medium">{HEALTH_LABEL[health.state]}</div>
      <p className="text-[11px] opacity-90">{health.reason}</p>

      {/* Three separate clocks. They are shown together because a reader who
          sees only one of them will assume the other two are the same age. */}
      <div className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] opacity-80 sm:grid-cols-3">
        <div>Baseline chấp nhận: <span className="font-mono">{when(health.acceptedAt)}</span></div>
        <div>Đo gần nhất: <span className="font-mono">{when(health.observedAt)}</span></div>
        <div>Diagnostics đầy đủ: <span className="font-mono">{when(health.diagnosticsAt)}</span></div>
      </div>

      {health.changes.length > 0 && (
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="text-left opacity-70">
              <th className="pr-2 font-medium">Trường</th>
              <th className="pr-2 font-medium">Baseline</th>
              <th className="font-medium">Đo được</th>
            </tr>
          </thead>
          <tbody>
            {health.changes.map((c) => (
              <tr key={c.field} className="border-t border-current/20 align-top">
                <td className="pr-2 py-0.5 font-mono whitespace-nowrap">{c.field}</td>
                <td className="pr-2 py-0.5 break-all opacity-80">{c.baseline ?? '—'}</td>
                <td className="py-0.5 break-all">{c.observed ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {health.state === 'changed' && onAcceptBaseline && (
        <button
          onClick={onAcceptBaseline}
          disabled={acceptDisabled}
          title="Ghi lần đo gần nhất thành baseline mới cho profile này"
          className="mt-2 rounded-lg border border-current/40 px-2 py-1 text-[11px] hover:bg-current/10 disabled:opacity-50 transition-colors"
        >
          Chấp nhận lần đo này làm baseline
        </button>
      )}
    </div>
  );
}

export function FingerprintPanel({
  fingerprint, visitorId, diagnostics, platform, health, onAcceptBaseline, acceptDisabled,
}: Props) {
  if (!fingerprint) {
    return (
      <div className="mt-2 space-y-3">
        {health && <HealthSection health={health} />}
        <p className="text-xs text-gray-400 italic">Chưa có baseline — khởi động profile để ghi nhận fingerprint.</p>
      </div>
    );
  }
  // `key` matches the field names profile-health.ts compares, so a changed
  // field can be marked here without a second, drifting list of names.
  const rows: { key: string | null; label: string; value: string }[] = [
    { key: null, label: 'Spoof OS', value: platform === 'macos' ? 'macOS' : 'Windows' },
    { key: null, label: 'FingerprintJS ID', value: visitorId ?? 'chưa đo' },
    { key: 'userAgent', label: 'User Agent', value: fingerprint.userAgent },
    { key: 'platform', label: 'Platform', value: fingerprint.platform },
    { key: 'hardwareConcurrency', label: 'CPU cores', value: String(fingerprint.hardwareConcurrency) },
    { key: 'deviceMemory', label: 'Device memory', value: fingerprint.deviceMemory != null ? `${fingerprint.deviceMemory} GB` : 'N/A' },
    { key: 'languages', label: 'Languages', value: fingerprint.languages.join(', ') },
    { key: 'screen', label: 'Screen', value: `${fingerprint.screen.width}×${fingerprint.screen.height} @${fingerprint.screen.colorDepth}bit` },
    { key: 'devicePixelRatio', label: 'DPR', value: String(fingerprint.devicePixelRatio) },
    { key: 'webglVendor', label: 'WebGL vendor', value: fingerprint.webglVendor ?? 'N/A' },
    { key: 'webglRenderer', label: 'WebGL renderer', value: fingerprint.webglRenderer ?? 'N/A' },
    { key: 'timezone', label: 'Timezone', value: fingerprint.timezone },
    { key: 'webdriver', label: 'Webdriver', value: fingerprint.webdriver ? 'YES ⚠' : 'no' },
  ];
  const changed = new Set((health?.changes ?? []).map((c) => c.field));
  return (
    <div className="mt-2 space-y-3">
      {health && (
        <HealthSection health={health} onAcceptBaseline={onAcceptBaseline} acceptDisabled={acceptDisabled} />
      )}
      {/* The table below is the BASELINE, not the last reading. Rows that the
          last reading disagreed with are marked so the two are never confused. */}
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-700">
              <td className="pr-3 py-1 text-gray-400 font-medium whitespace-nowrap align-top">
                {r.label}
                {r.key && changed.has(r.key) && <span className="ml-1 text-amber-400" title="Lần đo gần nhất khác baseline">•</span>}
              </td>
              <td className="py-1 break-all">{r.value}</td>
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
