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
      out.push({ profileId: p.id, level: 'high', kind: 'no-proxy', message: 'Không có proxy — chia sẻ IP máy chủ, dễ bị liên kết.' });
    }
    const lockedIp = p.resolvedIdentity?.exitIp;
    const lastIp = p.lastProxyCheck?.exitIp;
    if (p.identityLocked && lockedIp && lastIp && lockedIp !== lastIp) {
      out.push({ profileId: p.id, level: 'high', kind: 'ip-changed', message: `IP proxy đã đổi (${lastIp}) so với identity đã khoá (${lockedIp}).` });
    }
    // Seeing an IPv6 is NOT the same as leaking one. The probe runs inside the
    // proxied browser, so a SOCKS5/HTTP proxy that carries IPv6 legitimately
    // returns its own address here. From one profile we cannot tell the proxy's
    // IPv6 from the host's, so this is reported as context, not as a risk.
    // The provable case is handled below (ipv6-shared).
    if (p.lastProxyCheck?.ipv6) {
      out.push({
        profileId: p.id,
        level: 'low',
        kind: 'ipv6-present',
        message: `Có IPv6 truy cập được (${p.lastProxyCheck.ipv6}). Chưa kết luận được là rò rỉ — địa chỉ này có thể do chính proxy cấp. Chỉ chắc chắn rò rỉ khi nhiều profile dùng proxy khác nhau cùng thấy một IPv6.`,
      });
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
  // An IPv6 seen through two DIFFERENT proxies cannot be coming from either of
  // them. That is host-originated, and it links the two profiles outright.
  const ipv6Groups = new Map<string, { id: string; proxyKey: string | null }[]>();
  for (const p of profiles) {
    const v6 = p.lastProxyCheck?.ipv6;
    if (v6) (ipv6Groups.get(v6) ?? ipv6Groups.set(v6, []).get(v6)!).push({ id: p.id, proxyKey: key(p) });
  }
  for (const [v6, members] of ipv6Groups) {
    const distinctProxies = new Set(members.map((m) => m.proxyKey ?? `none:${m.id}`));
    if (members.length < 2 || distinctProxies.size < 2) continue;
    for (const m of members) {
      out.push({ profileId: m.id, level: 'high', kind: 'ipv6-shared', message: `Cùng một IPv6 (${v6}) với profile dùng proxy khác — địa chỉ này đến từ máy chủ chứ không phải proxy. Đây là liên kết thật.` });
    }
  }

  for (const ids of [...exitIpGroups.values()].filter((x) => x.length > 1)) {
    for (const id of ids) out.push({ profileId: id, level: 'high', kind: 'dup-exit-ip', message: 'Trùng actual exit IP với profile đã khoá khác.' });
  }
  // Same ASN + city + different IP is what a normal ISP looks like: millions of
  // unrelated real users share exactly that. It is NOT evidence that two
  // profiles are the same person, so it must not be presented as a risk — only
  // as context for a user who bought several IPs from one small provider.
  for (const ids of [...asnGeoGroups.values()].filter((x) => x.length > 1)) {
    for (const id of ids) out.push({ profileId: id, level: 'low', kind: 'same-asn-geo', message: 'Cùng ASN/ISP và thành phố với profile đã khoá khác, nhưng IP khác nhau — đây là chuyện bình thường của một ISP, không phải bằng chứng liên kết.' });
  }
  for (const ids of findProxyConflicts(profiles)) {
    for (const id of ids) {
      out.push({ profileId: id, level: 'medium', kind: 'dup-proxy-host', message: 'Trùng host proxy với profile khác.' });
    }
  }
  return out;
}
