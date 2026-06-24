import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CollisionRow, ProfileObservation, RuleResult } from './types';
import { consistency, isConsistent } from './consistency';
import { collisions, hasHighCollision } from './collisions';

export interface RunMeta {
  startedAt: string;
  cloakBrowserVersion: string;
  hostOS: string;
  profileCount: number;
  screen: string;
  withProxies: boolean;
  external: boolean;
}

export interface VerifyReport {
  meta: RunMeta;
  observations: ProfileObservation[];
  collisions: CollisionRow[];
  consistency: { profileId: string; results: RuleResult[] }[];
  verdict: string;
}

/** Assemble the full analysis (collisions + per-profile consistency + verdict). */
export function buildReport(meta: RunMeta, observations: ProfileObservation[]): VerifyReport {
  const rows = collisions(observations);
  const perProfile = observations.map((o) => ({ profileId: o.profileId, results: consistency(o) }));
  return { meta, observations, collisions: rows, consistency: perProfile, verdict: verdictLine(observations, rows, perProfile) };
}

function verdictLine(
  observations: ProfileObservation[],
  rows: CollisionRow[],
  perProfile: { profileId: string; results: RuleResult[] }[],
): string {
  const live = observations.filter((o) => o.ok);
  const failedLaunch = observations.length - live.length;
  const highRows = rows.filter((r) => r.severity === 'HIGH');
  const consistencyFailures = perProfile.filter(
    (p) => live.some((o) => o.profileId === p.profileId) && !isConsistent(p.results),
  );

  const parts: string[] = [];
  parts.push(highRows.length === 0
    ? `0 HIGH collisions across ${live.length} profile(s)`
    : `${highRows.length} HIGH collision(s): ${highRows.map((r) => r.vector).join(', ')}`);
  parts.push(consistencyFailures.length === 0
    ? 'all profiles internally consistent'
    : `${consistencyFailures.length} profile(s) with consistency failures`);
  if (failedLaunch > 0) parts.push(`${failedLaunch} profile(s) failed to launch`);

  const ok = highRows.length === 0 && consistencyFailures.length === 0 && failedLaunch === 0;
  return `${ok ? 'PASS' : 'ATTENTION'} — ${parts.join('; ')}.`;
}

const tick = (s: RuleResult['status']): string => (s === 'pass' ? '✅' : s === 'warn' ? '⚠️' : '❌');

function metaTable(m: RunMeta): string {
  return [
    '| Field | Value |',
    '| --- | --- |',
    `| Run started | ${m.startedAt} |`,
    `| CloakBrowser binary | ${m.cloakBrowserVersion} |`,
    `| Host OS | ${m.hostOS} |`,
    `| Profiles | ${m.profileCount} |`,
    `| Screen (real monitor) | ${m.screen} |`,
    `| Proxies | ${m.withProxies ? 'yes' : 'no'} |`,
    `| External detectors | ${m.external ? 'opened' : 'skipped'} |`,
  ].join('\n');
}

function collisionTable(rows: CollisionRow[], observations: ProfileObservation[]): string {
  if (rows.length === 0) {
    return 'No vector is shared across any two profiles (every tracked vector is distinct).';
  }
  const out = ['| Vector | Severity | Shared by | Value |', '| --- | --- | --- | --- |'];
  for (const r of rows) {
    for (const g of r.groups) {
      const names = g.profileIds.map((id) => nameOf(observations, id)).join(', ');
      out.push(`| ${r.vector} | ${r.severity} | ${names} | \`${truncate(g.value, 40)}\` |`);
    }
  }
  return out.join('\n');
}

function profileSection(o: ProfileObservation, results: RuleResult[]): string {
  if (!o.ok) {
    return `### ${o.profileName} (seed ${o.seed})\n\n**Failed to launch/probe:** ${o.error ?? 'unknown error'}`;
  }
  const lines: string[] = [];
  lines.push(`### ${o.profileName} (seed ${o.seed})`);
  lines.push('');
  lines.push(`- UA: \`${o.userAgent}\``);
  lines.push(`- platform: \`${o.platform}\` · UA-CH platform: \`${o.uaClientHints?.platform ?? 'n/a'}\``);
  lines.push(`- WebGL: \`${o.webglVendor ?? 'n/a'}\` / \`${o.webglRenderer ?? 'n/a'}\``);
  lines.push(`- screen ${o.screen.width}x${o.screen.height} (avail ${o.screen.availWidth}x${o.screen.availHeight}, depth ${o.screen.colorDepth}) · viewport ${o.innerWidth}x${o.innerHeight} · DPR ${o.devicePixelRatio}`);
  lines.push(`- cores ${o.hardwareConcurrency} · memory ${o.deviceMemory ?? 'n/a'} · touch ${o.maxTouchPoints}`);
  lines.push(`- timezone ${o.timezone} (offset ${o.timezoneOffset}) · languages ${o.languages.join(',')}`);
  lines.push(`- hashes: canvas \`${o.canvasHash}\` · audio \`${o.audioHash ?? 'null'}\` · font \`${o.fontHash}\` · clientRects \`${o.clientRectsHash}\``);
  lines.push('');
  lines.push('| Rule | Status | Detail |');
  lines.push('| --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.rule} | ${tick(r.status)} ${r.status} | ${r.message} |`);

  if (o.external?.length) {
    lines.push('');
    lines.push('**External detectors:**');
    for (const e of o.external) {
      if (e.status === 'unavailable') {
        lines.push(`- ${e.site}: unavailable (${e.error ?? 'no detail'})`);
      } else {
        const kv = Object.entries(e.headline ?? {}).map(([k, v]) => `${k}=${v ?? 'n/a'}`).join(', ');
        lines.push(`- ${e.site}: ${kv || 'no headline scraped'}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Cross-profile creepjs fingerprint distinctness — the reliable external signal.
 * Two profiles producing the same creepjs FP id would be a linkage a real
 * detector sees, independent of our own collision matrix.
 */
function externalSummary(observations: ProfileObservation[]): string {
  const rows = observations
    .filter((o) => o.ok)
    .map((o) => ({ name: o.profileName, fp: o.external?.find((e) => e.site === 'creepjs')?.headline?.fingerprint ?? null }));
  if (!rows.some((r) => r.fp)) {
    return 'creepjs fingerprint id not captured (read the open detector windows on the box).';
  }
  const captured = rows.filter((r) => r.fp);
  const distinct = new Set(captured.map((r) => String(r.fp))).size === captured.length;
  const out = [
    distinct
      ? `✅ creepjs fingerprint ids are **distinct** across all ${captured.length} captured profile(s).`
      : `❌ creepjs fingerprint ids **collide** — a detector would link these profiles.`,
    '',
    '| Profile | creepjs FP id |',
    '| --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.fp ? `\`${String(r.fp).slice(0, 24)}…\`` : 'n/a'} |`),
  ];
  return out.join('\n');
}

/** Render the full human-readable report.md. */
export function renderMarkdown(report: VerifyReport): string {
  const { meta, observations, collisions: rows, consistency: perProfile } = report;
  const sections: string[] = [];
  sections.push('# Windows Anti-Detect Verification Report');
  sections.push('');
  sections.push(`> **${report.verdict}**`);
  sections.push('');
  sections.push('## Run');
  sections.push(metaTable(meta));
  sections.push('');
  sections.push('## Collision matrix (cross-profile uniqueness)');
  sections.push('');
  sections.push('HIGH = device linkage if shared. CONTEXT = plausibly shared on real machines (reported, not failed).');
  sections.push('');
  sections.push(collisionTable(rows, observations));
  sections.push('');
  if (meta.external) {
    sections.push('## External detectors summary');
    sections.push('');
    sections.push(externalSummary(observations));
    sections.push('');
  }
  sections.push('## Per-profile consistency');
  for (const o of observations) {
    const results = perProfile.find((p) => p.profileId === o.profileId)?.results ?? [];
    sections.push('');
    sections.push(profileSection(o, results));
  }
  sections.push('');
  return sections.join('\n');
}

/** Write observations.json + report.md into reports/<timestamp>/ and return the dir. */
export function writeReport(reportsRoot: string, report: VerifyReport): string {
  const stamp = report.meta.startedAt.replace(/[:.]/g, '-');
  const dir = join(reportsRoot, stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'observations.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(report));
  return dir;
}

function nameOf(observations: ProfileObservation[], id: string): string {
  return observations.find((o) => o.profileId === id)?.profileName ?? id;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export { hasHighCollision };
