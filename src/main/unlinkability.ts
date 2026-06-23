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
    const lockedIp = p.resolvedIdentity?.exitIp;
    const lastIp = p.lastProxyCheck?.exitIp;
    if (p.identityLocked && lockedIp && lastIp && lockedIp !== lastIp) {
      out.push({ profileId: p.id, level: 'high', message: `IP proxy đã đổi (${lastIp}) so với identity đã khoá (${lockedIp}).` });
    }
    if (p.lastProxyCheck?.ipv6) {
      out.push({ profileId: p.id, level: 'medium', message: `IPv6 đang lộ ra ngoài (${p.lastProxyCheck.ipv6}) — kiểm tra proxy có cover IPv6 không.` });
    }
  }
  const exitIpGroups = new Map<string, string[]>();
  const asnGeoGroups = new Map<string, string[]>();
  for (const p of profiles) {
    const ip = p.resolvedIdentity?.exitIp;
    if (p.identityLocked && ip) (exitIpGroups.get(ip) ?? exitIpGroups.set(ip, []).get(ip)!).push(p.id);
    const snap = p.lastProxyCheck;
    if (p.identityLocked && snap?.asn && snap.country && snap.city) {
      const k = `${snap.asn}:${snap.country}:${snap.city}:${snap.isp ?? ''}`;
      (asnGeoGroups.get(k) ?? asnGeoGroups.set(k, []).get(k)!).push(p.id);
    }
  }
  for (const ids of [...exitIpGroups.values()].filter((x) => x.length > 1)) {
    for (const id of ids) out.push({ profileId: id, level: 'high', message: 'Trùng actual exit IP với profile đã khoá khác.' });
  }
  for (const ids of [...asnGeoGroups.values()].filter((x) => x.length > 1)) {
    for (const id of ids) out.push({ profileId: id, level: 'medium', message: 'Cùng ASN/ISP và vị trí proxy với profile đã khoá khác.' });
  }
  for (const ids of findProxyConflicts(profiles)) {
    for (const id of ids) {
      out.push({ profileId: id, level: 'medium', message: 'Trùng host proxy với profile khác.' });
    }
  }
  return out;
}
