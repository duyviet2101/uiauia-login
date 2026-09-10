// Re-run the pure analysis over a saved observations.json and rewrite report.md.
//
// Analysis code evolves faster than measurements: when a new field is added (or
// a field's meaning is corrected), the already-captured raw data can answer the
// new question without occupying the machine for another full matrix run.
//
//   npx tsx scripts/verify-windows/reanalyze.ts <report-dir> [...more dirs]

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildReport, renderMarkdown, type VerifyReport } from './report';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: reanalyze <report-dir> [...]');
  process.exit(1);
}

for (const dir of dirs) {
  const saved = JSON.parse(readFileSync(join(dir, 'observations.json'), 'utf8')) as VerifyReport;
  const rebuilt = buildReport(saved.meta, saved.observations);
  writeFileSync(join(dir, 'observations.json'), JSON.stringify(rebuilt, null, 2));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(rebuilt));
  console.log(`${dir}\n  ${rebuilt.verdict}`);
}
