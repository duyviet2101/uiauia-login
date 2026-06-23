import { useState } from 'react';
import type { Profile, ProxyConfig, ProxyTestResult, FingerprintPlatform, WindowCustomizationInput } from '../../main/types';
import { parseProxyString } from '../../main/proxy-parse';
import { api } from '../api';
import { Spinner } from './Spinner';
import { profileIconForeground } from '../../main/profile-window-customization';

export interface ProfileFormValues {
  name: string;
  platform: FingerprintPlatform;
  proxy: ProxyConfig | null;
  geoip: boolean;
  timezone: string | null;
  locale: string | null;
  startUrl: string | null;
  blockGeolocation: boolean;
  doNotTrack: boolean;
  windowCustomization: WindowCustomizationInput;
}

interface Props {
  initial?: Profile;
  onSubmit: (values: ProfileFormValues) => Promise<void> | void;
  onCancel: () => void;
}

const inputCls =
  'w-full rounded-lg bg-slate-700 px-2.5 py-1.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/70';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

function WindowIconPreview({ number, color }: { number?: number; color: string }) {
  return (
    <span
      className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/20 text-sm font-black text-white shadow-md"
      style={{ backgroundColor: color, color: profileIconForeground(color) }}
      aria-label={number ? `Icon cửa sổ số ${number}` : 'Icon cửa sổ được đánh số tự động'}
    >
      {number ?? '#'}
    </span>
  );
}

export function ProfileForm({ initial, onSubmit, onCancel }: Props) {
  const editing = !!initial;
  const identityLocked = !!initial?.identityLocked;
  const [name, setName] = useState(initial?.name ?? '');
  const [platform, setPlatform] = useState<FingerprintPlatform>(initial?.platform ?? 'windows');
  const [useProxy, setUseProxy] = useState(initial ? !!initial.proxy : true);
  const [proxyType, setProxyType] = useState<'http' | 'socks5'>(initial?.proxy?.type ?? 'http');
  const [host, setHost] = useState(initial?.proxy?.host ?? '');
  const [port, setPort] = useState(initial?.proxy ? String(initial.proxy.port) : '');
  const [username, setUsername] = useState(initial?.proxy?.username ?? '');
  const [password, setPassword] = useState(initial?.proxy?.password ?? '');
  const [geoip, setGeoip] = useState(initial?.geoip ?? true);
  const [timezone, setTimezone] = useState(initial?.timezone ?? '');
  const [locale, setLocale] = useState(initial?.locale ?? '');
  const [startUrl, setStartUrl] = useState(initial?.startUrl ?? '');
  const [blockGeolocation, setBlockGeolocation] = useState(initial?.blockGeolocation ?? true);
  const [doNotTrack, setDoNotTrack] = useState(initial?.doNotTrack ?? false);
  const [windowCustomizationEnabled, setWindowCustomizationEnabled] = useState(initial?.windowCustomization.enabled ?? true);
  const [windowColor, setWindowColor] = useState(initial?.windowCustomization.color ?? '');

  const [quickPaste, setQuickPaste] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);

  function applyQuickPaste(raw: string) {
    setQuickPaste(raw);
    const parsed = parseProxyString(raw);
    if (!parsed) return;
    setHost(parsed.host);
    setPort(String(parsed.port));
    setUsername(parsed.username ?? '');
    setPassword(parsed.password ?? '');
    if (parsed.type) setProxyType(parsed.type);
    setTestResult(null);
  }

  function buildProxy(): ProxyConfig | null {
    if (!useProxy || !host || !port) return null;
    return {
      type: proxyType,
      host: host.trim(),
      port: Number(port),
      username: username || undefined,
      password: password || undefined,
    };
  }

  async function handleTestProxy() {
    const proxy = buildProxy();
    if (!proxy) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testProxy(proxy));
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        platform,
        proxy: buildProxy(),
        geoip,
        timezone: timezone.trim() || null,
        locale: locale.trim() || null,
        startUrl: startUrl.trim() || null,
        blockGeolocation,
        doNotTrack,
        windowCustomization: {
          enabled: windowCustomizationEnabled,
          color: windowColor || null,
        },
      });
    } finally {
      setSubmitting(false);
    }
  }

  const canTest = useProxy && !!host && !!port && !testing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl bg-slate-800 p-6 shadow-2xl ring-1 ring-slate-700"
      >
        <h2 className="text-lg font-semibold text-white">{editing ? 'Sửa profile' : 'Tạo profile mới'}</h2>

        <div>
          <label className={labelCls}>Tên profile *</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Facebook acc 1"
          />
        </div>

        <div>
          <label className={labelCls}>Hệ điều hành giả lập</label>
          <select className={inputCls} value={platform} disabled={identityLocked} onChange={(e) => setPlatform(e.target.value as FingerprintPlatform)}>
            <option value="windows">Windows (đa dạng, ẩn máy thật — khuyên dùng)</option>
            <option value="macos">macOS (giống máy Mac thật — ít biến thiên)</option>
          </select>
          {identityLocked && <p className="mt-1 text-[11px] text-amber-300">Identity đã khoá. Reset identity trước khi đổi fingerprint/proxy.</p>}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-blue-500"
            checked={useProxy}
            disabled={identityLocked}
            onChange={(e) => {
              setUseProxy(e.target.checked);
              setTestResult(null);
            }}
          />
          Dùng proxy (khuyên dùng để chống liên kết IP)
        </label>

        {useProxy && (
          <div className="space-y-3 rounded-lg border-l-2 border-blue-600 bg-slate-900/40 p-3">
            <div>
              <label className={labelCls}>Dán nhanh — tự tách host:port:user:pass</label>
              <input
                className={inputCls}
                value={quickPaste}
                disabled={identityLocked}
                onChange={(e) => applyQuickPaste(e.target.value)}
                placeholder="145.223.61.148:8180:username:password"
              />
            </div>
            <div className="flex gap-2">
              <div className="w-24">
                <label className={labelCls}>Loại</label>
                <select className={inputCls} value={proxyType} disabled={identityLocked} onChange={(e) => setProxyType(e.target.value as 'http' | 'socks5')}>
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div className="flex-1">
                <label className={labelCls}>Host *</label>
                <input
                  className={inputCls}
                  value={host}
                  disabled={identityLocked}
                  onChange={(e) => { setHost(e.target.value); setTestResult(null); }}
                  placeholder="1.2.3.4"
                  required={useProxy}
                />
              </div>
              <div className="w-20">
                <label className={labelCls}>Port *</label>
                <input
                  className={inputCls}
                  type="number"
                  value={port}
                  disabled={identityLocked}
                  onChange={(e) => { setPort(e.target.value); setTestResult(null); }}
                  placeholder="1080"
                  required={useProxy}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>Username</label>
                <input className={inputCls} value={username} disabled={identityLocked} onChange={(e) => setUsername(e.target.value)} placeholder="(tuỳ chọn)" />
              </div>
              <div className="flex-1">
                <label className={labelCls}>Password</label>
                <input className={inputCls} type="password" value={password} disabled={identityLocked} onChange={(e) => setPassword(e.target.value)} placeholder="(tuỳ chọn)" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input type="checkbox" className="accent-blue-500" checked={geoip} disabled={identityLocked} onChange={(e) => setGeoip(e.target.checked)} />
              geoip — tự khớp timezone &amp; ngôn ngữ theo IP của proxy
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestProxy}
                disabled={!canTest || identityLocked}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testing && <Spinner size={12} />}
                {testing ? 'Đang kiểm tra…' : 'Test proxy'}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.ok ? `OK · IP ${testResult.ip} · ${testResult.latencyMs}ms` : `Lỗi: ${testResult.error}`}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelCls}>Timezone (đè geoip)</label>
            <input className={inputCls} value={timezone} disabled={identityLocked} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Ho_Chi_Minh" />
          </div>
          <div className="flex-1">
            <label className={labelCls}>Ngôn ngữ (đè geoip)</label>
            <input className={inputCls} value={locale} disabled={identityLocked} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Trang khởi đầu</label>
          <input className={inputCls} value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://www.google.com (mặc định)" />
        </div>

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <p className="text-xs font-medium text-slate-400">Quyền riêng tư</p>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={blockGeolocation}
              onChange={(e) => setBlockGeolocation(e.target.checked)}
            />
            Chặn định vị (geolocation) — từ chối mọi yêu cầu vị trí
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={doNotTrack}
              onChange={(e) => setDoNotTrack(e.target.checked)}
            />
            Do Not Track (DNT) — gửi tín hiệu “không theo dõi”
          </label>
          <p className="text-[11px] text-slate-500">
            Ghi vào Preferences thật của Chromium (không phải JS hack). Chặn định vị triệt tiêu rò vị trí thật khi lỡ bấm Cho phép.
            DNT để tắt sẽ giống số đông hơn. Sửa được cả khi identity đã khoá.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          <div className="flex items-center gap-3">
            <WindowIconPreview
              number={initial?.windowCustomization.number}
              color={windowColor || '#2563EB'}
            />
            <div className="min-w-0 flex-1">
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-slate-200">
                <input
                  type="checkbox"
                  className="accent-blue-500"
                  checked={windowCustomizationEnabled}
                  onChange={(e) => setWindowCustomizationEnabled(e.target.checked)}
                />
                Nhận diện cửa sổ Windows
              </label>
              <p className="mt-1 text-[11px] text-slate-500">
                Title {initial ? `[#${initial.windowCustomization.number}]` : '[# tự động]'} và icon native; không thay đổi document.title hay fingerprint.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label className={labelCls}>Màu icon</label>
              <input
                type="color"
                value={windowColor || '#2563EB'}
                onChange={(e) => setWindowColor(e.target.value.toUpperCase())}
                disabled={!windowCustomizationEnabled}
                className="h-9 w-16 cursor-pointer rounded-md border border-slate-600 bg-slate-700 p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            {!initial && windowColor && (
              <button
                type="button"
                onClick={() => setWindowColor('')}
                className="mb-0.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
              >
                Màu tự động
              </button>
            )}
            <span className="mb-1 text-xs text-slate-500">{windowColor || 'Tự động theo số profile'}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg bg-slate-600 px-4 py-1.5 text-sm text-white hover:bg-slate-500 transition-colors">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Spinner size={12} />}
            {submitting ? 'Đang lưu…' : editing ? 'Lưu' : 'Tạo'}
          </button>
        </div>
      </form>
    </div>
  );
}
