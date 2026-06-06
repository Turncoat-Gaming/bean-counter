// normalize.js — Pure transform from Satisfactory `Docs.json` into the
// bean-counter dataset schema (see src/data/SCHEMA.md).
//
// This module is the single source of truth for data normalization. It is used
// *identically* by:
//   - tools/import.html  (in the browser, the canonical/repeatable path)
//   - tools/gen-data.mjs (a dev-only Node bootstrap that emits the same bytes)
//
// It has zero dependencies and does no I/O: callers hand it the already-parsed
// Docs array and get back a plain dataset object. Determinism is a hard
// requirement — given the same Docs.json and version, the output is byte-stable
// (keys are sorted, no timestamps).

// Buildings we treat as automatable production machines. A recipe is included
// only if it can be produced in one of these. Everything else (build-gun
// recipes, manual workbench crafts, customizer recipes) is dropped.
const MANUFACTURER_GROUPS = [
  'FGBuildableManufacturer',
  'FGBuildableManufacturerVariablePower',
];

// Satisfactory stores fluid/gas amounts scaled by 1000 (millilitres). We expose
// fluids in m³, so we divide those amounts back down.
const FLUID_FORMS = new Set(['RF_LIQUID', 'RF_GAS']);

function shortNativeClass(nativeClass) {
  // "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'" -> "FGRecipe"
  const m = nativeClass.match(/\.([A-Za-z0-9_]+)'?$/);
  return m ? m[1] : nativeClass;
}

function groupClasses(docs, shortName) {
  const group = docs.find((g) => shortNativeClass(g.NativeClass) === shortName);
  return group ? group.Classes : [];
}

function normForm(mForm) {
  switch (mForm) {
    case 'RF_LIQUID': return 'liquid';
    case 'RF_GAS': return 'gas';
    default: return 'solid';
  }
}

// Pull `Desc_Foo_C` class names + amounts out of a stringified ingredient/product
// tuple list, e.g.  ((ItemClass="...Desc_OreIron.Desc_OreIron_C'",Amount=1))
function parseItemAmounts(raw, itemForms) {
  if (!raw) return [];
  const out = [];
  const re = /ItemClass="[^"]*?\.([A-Za-z0-9_]+)'",Amount=([0-9.]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const item = m[1];
    let amount = Number(m[2]);
    if (FLUID_FORMS.has(itemForms.get(item))) amount /= 1000;
    out.push({ item, amount });
  }
  return out;
}

// Building class names referenced in mProducedIn, e.g. ".../Build_SmelterMk1_C"
function parseProducedIn(raw) {
  if (!raw) return [];
  const out = [];
  const re = /(Build_[A-Za-z0-9_]+_C)/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m[1]);
  return out;
}

// Build a {key: value} object with keys inserted in sorted order, so
// JSON.stringify produces a stable, diff-friendly result.
function sortedObject(entries) {
  const out = {};
  for (const k of Object.keys(entries).sort()) out[k] = entries[k];
  return out;
}

export function normalizeDocs(docs, { gameVersion } = {}) {
  if (!Array.isArray(docs)) {
    throw new Error('normalizeDocs: expected the parsed Docs.json array');
  }

  // ---- Items: any class named Desc_*_C that has a display name. ----
  const itemForms = new Map();
  const items = {};
  for (const group of docs) {
    for (const cls of group.Classes) {
      const cn = cls.ClassName;
      if (!cn || !cn.startsWith('Desc_') || !cls.mDisplayName) continue;
      const form = normForm(cls.mForm);
      itemForms.set(cn, cls.mForm);
      items[cn] = { name: cls.mDisplayName, form };
    }
  }

  // ---- Buildings (manufacturers) we can place recipes in. ----
  const buildings = {};
  for (const groupName of MANUFACTURER_GROUPS) {
    for (const cls of groupClasses(docs, groupName)) {
      buildings[cls.ClassName] = {
        name: cls.mDisplayName,
        power: Number(cls.mPowerConsumption) || 0,
      };
    }
  }

  // ---- Recipes producible in one of those buildings. ----
  const recipes = {};
  for (const r of groupClasses(docs, 'FGRecipe')) {
    const producedIn = parseProducedIn(r.mProducedIn);
    const building = producedIn.find((b) => buildings[b]);
    if (!building) continue; // not automatable in a factory machine — skip

    const inputs = parseItemAmounts(r.mIngredients, itemForms);
    const outputs = parseItemAmounts(r.mProduct, itemForms);
    if (outputs.length === 0) continue;

    recipes[r.ClassName] = {
      name: r.mDisplayName,
      time: Number(r.mManufactoringDuration) || 0,
      building,
      inputs,
      outputs,
    };
  }

  return {
    gameVersion: gameVersion || null,
    schema: 1,
    items: sortedObject(items),
    buildings: sortedObject(buildings),
    recipes: sortedObject(recipes),
  };
}
