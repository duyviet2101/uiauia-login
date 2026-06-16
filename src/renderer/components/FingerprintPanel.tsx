import type { Fingerprint } from '../../main/types';

interface Props { fingerprint: Fingerprint | null }

export function FingerprintPanel({ fingerprint }: Props) {
  if (!fingerprint) return (
    <p className="text-xs text-gray-400 italic">Chưa có dữ liệu — khởi động profile để ghi nhận fingerprint.</p>
  );
  const rows: [string, string][] = [
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
    <table className="w-full text-xs mt-2">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-gray-700">
            <td className="pr-3 py-1 text-gray-400 font-medium whitespace-nowrap">{k}</td>
            <td className="py-1 break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
