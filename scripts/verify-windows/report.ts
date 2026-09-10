import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CollisionRow, LaunchMode, ProfileObservation, RuleResult } from './types';
import type { Persona } from './persona';
import { consistency, isConsistent } from './consistency';
import { collisions, hasHighCollision } from './collisions';
import {
  analyzeStability,
  driftingFields,
  fullyShared,
  noisyFields,
  type StabilityRow,
} from './stability';

export interface RunMeta {
  startedAt: string;
  /** Version recorded in the cloakbrowser cache/marker. */
  cloakBrowserVersion: string;
  /** Version the launched binary itself reports (--version). May differ. */
  browserVersion?: string;
  packageVersion?: string;
  binaryTier?: string;
  hostOS: string;
  persona?: Persona;
  launchMode?: LaunchMode;
  group?: string;
  label?: string;
  profileCount: number;
  opens?: number;
  repeats?: number;
  screen: string;
  withProxies: boolean;
  external: boolean;
  droppedArgs?: string[];
  extraArgs?: string[];
}

export interface VerifyReport {
  meta: RunMeta;
  observations: ProfileObservation[];
  collisions: CollisionRow[];
  stability: StabilityRow[];
  consistency: { profileId: string; results: RuleResult[] }[];
  verdict: string;
}

/** One representative observation per profile (the first successful one). */
function representatives(observations: ProfileObservation[]): ProfileObservation[] {
  const seen = new Map<string, ProfileObservation>();
  for (const o of observations) {
    if (!o.ok) continue;
    if (!seen.has(o.profileId)) seen.set(o.profileId, o);
  }
  return [...seen.values()];
}

/** Assemble the full analysis (stability + collisions + consistency + verdict). */
export function buildReport(meta: RunMeta, observations: ProfileObservation[]): VerifyReport {
  const reps = representatives(observations);
  const rows = collisions(reps);
  const stability = analyzeStability(observations);
  const perProfile = reps.map((o) => ({ profileId: o.profileId, results: consistency(o, meta.persona ?? o.persona) }));
  return {
    meta,
    observations,
    collisions: rows,
    stability,
    consistency: perProfile,
    verdict: verdictLine(observations, reps, stability, perProfile),
  };
}

function verdictLine(
  all: ProfileObservation[],
  reps: ProfileObservation[],
  stability: StabilityRow[],
  perProfile: { profileId: string; results: RuleResult[] }[],
): string {
  const failedOpens = all.filter((o) => !o.ok).length;
  const shared = fullyShared(stability);
  const drifting = driftingFields(stability);
  const consistencyFailures = perProfile.filter((p) => !isConsistent(p.results));

  const parts: string[] = [];
  parts.push(shared.length === 0
    ? `no HIGH field shared by all ${reps.length} profile(s)`
    : `${shared.length} HIGH field(s) shared by every profile: ${shared.map((r) => r.field).join(', ')}`);
  parts.push(drifting.length === 0
    ? 'no field drifted across reopens'
    : `${drifting.length} field/profile pair(s) drifted across reopens`);
  parts.push(consistencyFailures.length === 0
    ? 'all profiles internally consistent'
    : `${consistencyFailures.length} profile(s) with consistency failures`);
  if (failedOpens > 0) parts.push(`${failedOpens} measurement(s) failed`);

  const ok = shared.length === 0 && drifting.length === 0 && consistencyFailures.length === 0 && failedOpens === 0;
  return `${ok ? 'PASS' : 'ATTENTION'} — ${parts.join('; ')}.`;
}

const tick = (s: RuleResult['status']): string => (s === 'pass' ? 'PASS' : s === 'warn' ? 'WARN' : 'FAIL');

function metaTable(m: RunMeta): string {
  const rows = [
    '| Field | Value |',
    '| --- | --- |',
    `| Run started | ${m.startedAt} |`,
    `| Group / label | ${m.group ?? 'A'}${m.label ? ` — ${m.label}` : ''} |`,
    `| Persona (claimed OS) | ${m.persona ?? 'windows'} |`,
    `| Launch mode | ${m.launchMode ?? 'app'} |`,
    `| Host OS (real) | ${m.hostOS} |`,
    `| Binary version (cache) | ${m.cloakBrowserVersion}${m.binaryTier ? ` (tier ${m.binaryTier})` : ''} |`,
    `| Binary version (--version) | ${m.browserVersion ?? 'not captured'} |`,
    `| npm cloakbrowser | ${m.packageVersion ?? 'not captured'} |`,
    `| Profiles x opens x measures | ${m.profileCount} x ${m.opens ?? 1} x ${m.repeats ?? 1} |`,
    `| Screen (real monitor) | ${m.screen} |`,
    `| Proxies | ${m.withProxies ? 'yes' : 'no'} |`,
    `| External detectors | ${m.external ? 'opened' : 'skipped'} |`,
  ];
  if (m.droppedArgs?.length) rows.push(`| Dropped args (ablation) | \`${m.droppedArgs.join(' ')}\` |`);
  if (m.extraArgs?.length) rows.push(`| Extra args | \`${m.extraArgs.join(' ')}\` |`);
  return rows.join('\n');
}

function personaNote(m: RunMeta): string {
  const host = m.hostOS.split(' ')[0];
  const persona = m.persona ?? 'windows';
  const hostIsMac = host === 'darwin';
  const hostIsWin = host === 'win32';
  const crossed = (persona === 'windows' && hostIsMac) || (persona === 'macos' && hostIsWin);
  if (!crossed) return `Host and persona agree (${host} host presenting a ${persona} persona).`;
  return (
    `**Cross-platform run:** a ${host} host is presenting a ${persona} persona. ` +
    'Canvas, fonts and WebGL are still produced by the host stack, so results here describe ' +
    'the spoof, not a native machine of that OS.'
  );
}

function stabilityTable(rows: StabilityRow[]): string {
  const out = [
    '| Field | Severity | Stable in session | Stable across reopens | Distinct values | Shared by |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    const measured = r.profiles.filter((p) => p.perOpen.length > 0);
    if (measured.length === 0) {
      const reason = r.profiles[0]?.notMeasured[0]?.reason ?? 'not measured';
      out.push(`| ${r.field} | ${r.severity} | – | – | not measured | (${reason}) |`);
      continue;
    }
    const distinct = new Set(measured.map((p) => p.perOpen[0])).size;
    const sharedText = r.sharedBy.length === 0
      ? 'nobody'
      : r.sharedBy.map((g) => `${g.profileIds.length} profiles`).join('; ');
    out.push(
      `| ${r.field} | ${r.severity} | ${r.inSessionStable ? 'yes' : '**no**'} | ${r.acrossOpenStable ? 'yes' : '**no**'} | ${distinct}/${measured.length} | ${sharedText} |`,
    );
  }
  return out.join('\n');
}

function perProfileValues(rows: StabilityRow[], observations: ProfileObservation[]): string {
  const out: string[] = [];
  for (const r of rows) {
    if (r.profiles.every((p) => p.perOpen.length === 0)) continue;
    out.push(`**${r.field}**`);
    out.push('');
    out.push('| Profile | Values per open |');
    out.push('| --- | --- |');
    for (const p of r.profiles) {
      const values = p.perOpen.length
        ? p.perOpen.map((v) => `\`${truncate(v, 20)}\``).join(' · ')
        : p.notMeasured.map((n) => `${n.status}: ${n.reason}`).join('; ') || 'no value';
      out.push(`| ${nameOf(observations, p.profileId)} | ${values} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

/**
 * Digest equality is the wrong question for fonts. The digest can differ while
 * the underlying font SET is the same machine's set — on this binary measureText
 * is noised per seed, so a handful of borderline families flip and the hash
 * changes even though nothing about the installed fonts differs. A fingerprinter
 * measuring robustly still sees one shared set, so report the overlap directly.
 */
function fontOverlapSection(observations: ProfileObservation[]): string {
  const reps = representatives(observations).filter((o) => o.measurements?.fontAvailability.status === 'ok');
  if (reps.length < 2) return 'Need at least two successful profiles to compare font sets.';
  const sets = reps.map((o) => ({
    name: o.profileName,
    set: new Set(
      (o.measurements!.fontAvailability as { status: 'ok'; value: { families: { family: string; available: boolean }[] } })
        .value.families.filter((f) => f.available).map((f) => f.family),
    ),
  }));
  let common = new Set(sets[0].set);
  const union = new Set<string>();
  for (const s of sets) {
    common = new Set([...common].filter((f) => s.set.has(f)));
    for (const f of s.set) union.add(f);
  }
  const differing = [...union].filter((f) => !common.has(f)).sort();
  const pct = union.size === 0 ? 0 : Math.round((common.size / union.size) * 100);
  const lines = [
    `| Profile | Fonts detected |`,
    '| --- | --- |',
    ...sets.map((s) => `| ${s.name} | ${s.set.size} |`),
    '',
    `**${common.size} of ${union.size} families (${pct}%) are detected by EVERY profile.**`,
    differing.length
      ? `Only these differ: ${differing.join(', ')} — a borderline width comparison flipping under per-seed measureText noise, not a different font installation.`
      : 'No family differs between profiles.',
    '',
    'A shared font set is a shared machine signal regardless of what the availability digest hashes to.',
  ];
  return lines.join('\n');
}

function webrtcSection(observations: ProfileObservation[]): string {
  const reps = representatives(observations);
  if (reps.length === 0) return 'No successful measurement.';
  const out = [
    '| Profile | Status | Candidates | Addresses | Public IP seen |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const o of reps) {
    const m = o.measurements?.webrtc;
    if (!m) {
      out.push(`| ${o.profileName} | not measured | – | – | – |`);
      continue;
    }
    if (m.status !== 'ok') {
      out.push(`| ${o.profileName} | ${m.status} | – | – | ${m.reason} |`);
      continue;
    }
    const publicIps = m.value.candidates.filter((c) => c.publicIp);
    out.push(
      `| ${o.profileName} | ok${m.value.complete ? '' : ' (timeout)'} | ${m.value.candidates.length} | ${m.value.addresses.join(', ') || 'none'} | ${publicIps.length ? `**yes** (${publicIps.map((c) => c.address).join(', ')})` : 'no'} |`,
    );
  }
  out.push('');
  out.push(
    'Addresses are masked; comparison uses a digest of the full value. ' +
      'A public IP here is a WebRTC leak candidate — with no proxy in the run it is the host address, ' +
      'which only proves the flag did not replace it, not that a proxied session leaks.',
  );
  return out.join('\n');
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
  if (o.webglExtensions?.length) {
    lines.push(`- WebGL extensions: ${o.webglExtensions.length} (\`${o.webglExtensions.slice(0, 6).join(', ')}…\`)`);
  }
  lines.push(`- screen ${o.screen.width}x${o.screen.height} (avail ${o.screen.availWidth}x${o.screen.availHeight}, depth ${o.screen.colorDepth}) · viewport ${o.innerWidth}x${o.innerHeight} · DPR ${o.devicePixelRatio}`);
  lines.push(`- cores ${o.hardwareConcurrency} · memory ${o.deviceMemory ?? 'n/a'} · touch ${o.maxTouchPoints}`);
  lines.push(`- timezone ${o.timezone} (offset ${o.timezoneOffset}) · languages ${o.languages.join(',')}`);
  const fontsOk = o.measurements?.fontAvailability;
  if (fontsOk?.status === 'ok') {
    lines.push(`- fonts: ${fontsOk.value.availableCount}/${fontsOk.value.totalCount} of the persona dictionary available`);
  }
  if (o.launchArgs?.length) {
    lines.push(`- launch args: \`${o.launchArgs.join(' ')}\``);
  }
  lines.push('');
  lines.push('| Rule | Status | Detail |');
  lines.push('| --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.rule} | ${tick(r.status)} | ${r.message} |`);

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
 */
function externalSummary(observations: ProfileObservation[]): string {
  const rows = representatives(observations)
    .map((o) => ({ name: o.profileName, fp: o.external?.find((e) => e.site === 'creepjs')?.headline?.fingerprint ?? null }));
  if (!rows.some((r) => r.fp)) {
    return 'creepjs fingerprint id not captured (read the open detector windows on the box).';
  }
  const captured = rows.filter((r) => r.fp);
  const distinct = new Set(captured.map((r) => String(r.fp))).size === captured.length;
  const out = [
    distinct
      ? `creepjs fingerprint ids are **distinct** across all ${captured.length} captured profile(s).`
      : 'creepjs fingerprint ids **collide** — a detector would link these profiles.',
    '',
    '| Profile | creepjs FP id |',
    '| --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.fp ? `\`${String(r.fp).slice(0, 24)}…\`` : 'n/a'} |`),
  ];
  return out.join('\n');
}

/** Render the full human-readable report.md. */
export function renderMarkdown(report: VerifyReport): string {
  const { meta, observations, collisions: rows, stability, consistency: perProfile } = report;
  const drifting = driftingFields(stability);
  const noisy = noisyFields(stability);
  const sections: string[] = [];
  sections.push(`# Anti-Detect Verification Report — ${meta.persona ?? 'windows'} persona / ${meta.launchMode ?? 'app'} launch`);
  sections.push('');
  sections.push(`> **${report.verdict}**`);
  sections.push('');
  sections.push('## Run');
  sections.push(metaTable(meta));
  sections.push('');
  sections.push(personaNote(meta));
  sections.push('');
  sections.push('## Stability and sharing');
  sections.push('');
  sections.push(
    'Three separate questions. **Stable in session** = repeated measurements inside one browser window agree ' +
      '(if not, the field is noisy and cross-profile comparison of it means nothing). ' +
      '**Stable across reopens** = the profile keeps the value when reopened (identity stability). ' +
      '**Shared by** = distinct profiles reporting the same value, computed only from fields that are stable.',
  );
  sections.push('');
  sections.push(stabilityTable(stability));
  sections.push('');
  if (noisy.length) {
    sections.push(`**Noisy fields (differed within one open):** ${noisy.map((n) => `${n.field}@${nameOf(observations, n.profileId)}`).join(', ')}`);
    sections.push('');
  }
  if (drifting.length) {
    sections.push(`**Drifted across reopens:** ${drifting.map((d) => `${d.field}@${nameOf(observations, d.profileId)}`).join(', ')}`);
    sections.push('');
  }
  sections.push('### Values per profile');
  sections.push('');
  sections.push(perProfileValues(stability, observations));
  sections.push('## Font set overlap');
  sections.push('');
  sections.push(fontOverlapSection(observations));
  sections.push('');
  sections.push('## WebRTC');
  sections.push('');
  sections.push(webrtcSection(observations));
  sections.push('');
  sections.push('## Collision matrix (first measurement of each profile)');
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
  for (const o of representatives(observations)) {
    const results = perProfile.find((p) => p.profileId === o.profileId)?.results ?? [];
    sections.push('');
    sections.push(profileSection(o, results));
  }
  const failures = observations.filter((o) => !o.ok);
  if (failures.length) {
    sections.push('');
    sections.push('## Failed measurements');
    sections.push('');
    for (const f of failures) {
      sections.push(`- ${f.profileName} open ${f.openIndex ?? '?'}: ${f.error?.split('\n')[0] ?? 'unknown'}`);
    }
  }
  sections.push('');
  return sections.join('\n');
}

/** Write observations.json + report.md into reports/<timestamp>/ and return the dir. */
export function writeReport(reportsRoot: string, report: VerifyReport): string {
  const stamp = report.meta.startedAt.replace(/[:.]/g, '-');
  const suffix = report.meta.group ? `-${report.meta.group}` : '';
  const dir = join(reportsRoot, `${stamp}${suffix}`);
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
