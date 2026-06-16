import type { Profile, ProxyWarning } from './types';

function key(p: Profile): string | null {
  return p.proxy ? `${p.proxy.host}:${p.proxy.port}` : null;
}

export function findProxyConflicts(profiles: Profile[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const p of profiles) {
    const k = key(p);
    if (!k) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p.id);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export function proxyWarnings(profiles: Profile[]): ProxyWarning[] {
  const out: ProxyWarning[] = [];
  for (const p of profiles) {
    if (!p.proxy) {
      out.push({ profileId: p.id, level: 'high', message: 'Không có proxy — chia sẻ IP máy chủ, dễ bị liên kết.' });
    }
  }
  for (const ids of findProxyConflicts(profiles)) {
    for (const id of ids) {
      out.push({ profileId: id, level: 'medium', message: 'Trùng host proxy với profile khác — cùng IP.' });
    }
  }
  return out;
}
