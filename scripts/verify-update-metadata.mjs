import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function metadataAssetNames(contents) {
  const names = new Set();

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:-\s+url|path):\s+(.+?)\s*$/);
    if (!match) continue;

    const value = match[1].replace(/^(['"])(.*)\1$/, '$2');
    names.add(basename(decodeURIComponent(value)));
  }

  return [...names];
}

export function verifyUpdateMetadata(outputDir) {
  const dir = resolve(outputDir);
  const metadataFiles = readdirSync(dir).filter((name) => /^latest.*\.ya?ml$/.test(name));

  if (metadataFiles.length === 0) {
    throw new Error(`No update metadata found in ${dir}`);
  }

  for (const metadataFile of metadataFiles) {
    const contents = readFileSync(join(dir, metadataFile), 'utf8');
    const assetNames = metadataAssetNames(contents);

    if (assetNames.length === 0) {
      throw new Error(`${metadataFile} does not reference any update assets`);
    }

    for (const assetName of assetNames) {
      if (!existsSync(join(dir, assetName))) {
        throw new Error(`${metadataFile} references missing asset: ${assetName}`);
      }
    }
  }

  return metadataFiles;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDir = process.argv[2] ?? 'dist';
  const checked = verifyUpdateMetadata(outputDir);
  console.log(`Verified update assets referenced by: ${checked.join(', ')}`);
}
