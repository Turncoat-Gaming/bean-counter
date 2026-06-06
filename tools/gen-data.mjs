// gen-data.mjs — dev-only bootstrap that regenerates a versioned dataset from a
// raw Satisfactory Docs.json export, using the SAME normalize.js the in-browser
// importer (tools/import.html) uses. This is NOT part of the app and is not an
// npm project: it runs under plain Node with zero dependencies.
//
//   node tools/gen-data.mjs <version>
//   node tools/gen-data.mjs 1.2
//
// It reads   resources/gamedata/<version>/docs.en-us.json   (UTF-16LE)
// and writes src/data/<version>/recipes.json                (committed)
//
// The browser importer remains the canonical path; this just lets us bootstrap
// and verify that the committed bytes match what the browser would produce.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeDocs } from '../src/data/normalize.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const version = process.argv[2];
if (!version) {
  console.error('usage: node tools/gen-data.mjs <version>   (e.g. 1.2)');
  process.exit(1);
}

const inPath = resolve(root, `resources/gamedata/${version}/docs.en-us.json`);
const outDir = resolve(root, `src/data/${version}`);
const outPath = resolve(outDir, 'recipes.json');

// Satisfactory exports Docs.json as UTF-16LE with a BOM.
const docsText = new TextDecoder('utf-16le').decode(readFileSync(inPath));
const docs = JSON.parse(docsText);

const dataset = normalizeDocs(docs, { gameVersion: version });

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset, null, 1) + '\n');

console.log(`wrote ${outPath}`);
console.log(`  items:     ${Object.keys(dataset.items).length}`);
console.log(`  buildings: ${Object.keys(dataset.buildings).length}`);
console.log(`  recipes:   ${Object.keys(dataset.recipes).length}`);
