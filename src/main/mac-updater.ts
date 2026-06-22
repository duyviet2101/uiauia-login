import type { GithubAsset } from './types';

/** Chọn file .dmg khớp arch ('arm64' | 'x64'); fallback dmg không hậu tố, rồi dmg đầu tiên. */
export function pickDmgAsset(assets: GithubAsset[], arch: string): GithubAsset | null {
  const dmgs = assets.filter((x) => x.name.toLowerCase().endsWith('.dmg'));
  if (dmgs.length === 0) return null;
  const wantArm = arch === 'arm64';
  const tagged = dmgs.find((x) => {
    const n = x.name.toLowerCase();
    return wantArm ? n.includes('arm64') : (n.includes('x64') || n.includes('x86_64') || n.includes('intel'));
  });
  if (tagged) return tagged;
  const untagged = dmgs.find((x) => !/arm64|x64|x86_64|intel/i.test(x.name));
  return untagged ?? dmgs[0];
}
