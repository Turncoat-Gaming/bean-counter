// gen-data.js — dev-only bootstrap that regenerates a versioned dataset from a
// raw Satisfactory Docs.json export, using the SAME normalize.js the in-browser
// importer (tools/import.html) uses. NOT part of the app; runs under plain Node
// with zero dependencies and no package.json.
//
//   node tools/gen-data.js <version>      e.g.  node tools/gen-data.js 1.2
//
// Reads  resources/gamedata/<version>/docs.en-us.json   (UTF-16LE)
// Writes src/data/<version>/recipes.js                  (committed)
//
// The browser importer is the canonical path; this just lets us bootstrap and
// prove the committed bytes match what the browser produces.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeDocs, serializeDataset } = require('../src/data/normalize.js');

const root = path.resolve(__dirname, '..');
const version = process.argv[2];
if (!version) {
  console.error('usage: node tools/gen-data.js <version>   (e.g. 1.2)');
  process.exit(1);
}

const inPath = path.resolve(root, 'resources/gamedata/' + version + '/docs.en-us.json');
const outDir = path.resolve(root, 'src/data/' + version);
const outPath = path.resolve(outDir, 'recipes.js');

// Satisfactory exports Docs.json as UTF-16LE with a BOM.
const docsText = new TextDecoder('utf-16le').decode(fs.readFileSync(inPath));
const dataset = normalizeDocs(JSON.parse(docsText), { gameVersion: version });

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, serializeDataset(dataset));

console.log('wrote ' + outPath);
console.log('  items:     ' + Object.keys(dataset.items).length);
console.log('  buildings: ' + Object.keys(dataset.buildings).length);
console.log('  recipes:   ' + Object.keys(dataset.recipes).length);
