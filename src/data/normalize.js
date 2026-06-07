// normalize.js — Pure transform from Satisfactory `Docs.json` into the
// bean-counter dataset schema (see src/data/SCHEMA.md).
//
// Single source of truth for normalization, used identically by:
//   - tools/import.html  (in the browser, the canonical/repeatable path)
//   - tools/gen-data.js  (a dev-only Node bootstrap that emits the same bytes)
//
// UMD-style: in the browser it hangs off BeanCounter.normalize; under Node it is
// a CommonJS module. Zero dependencies, no I/O — callers pass the parsed Docs
// array and get back a plain dataset object. Output is byte-stable (sorted keys,
// no timestamps): same Docs.json + version => same bytes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.BeanCounter = root.BeanCounter || {}; root.BeanCounter.normalize = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Buildings treated as automatable production machines. A recipe is kept only
  // if it can be produced in one of these (drops build-gun / workbench / customizer recipes).
  const MANUFACTURER_GROUPS = ['FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower'];

  // Fluid/gas amounts are stored ×1000 (millilitres); we expose them in m³.
  const FLUID_FORMS = new Set(['RF_LIQUID', 'RF_GAS']);

  function shortNativeClass(nativeClass) {
    const m = nativeClass.match(/\.([A-Za-z0-9_]+)'?$/);
    return m ? m[1] : nativeClass;
  }

  function groupClasses(docs, shortName) {
    const group = docs.find((g) => shortNativeClass(g.NativeClass) === shortName);
    return group ? group.Classes : [];
  }

  function normForm(mForm) {
    if (mForm === 'RF_LIQUID') return 'liquid';
    if (mForm === 'RF_GAS') return 'gas';
    return 'solid';
  }

  // Pull `Desc_Foo_C` class names + amounts out of a stringified tuple list, e.g.
  //   ((ItemClass="...Desc_OreIron.Desc_OreIron_C'",Amount=1))
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

  function sortedObject(entries) {
    const out = {};
    for (const k of Object.keys(entries).sort()) out[k] = entries[k];
    return out;
  }

  function normalizeDocs(docs, opts) {
    const gameVersion = (opts && opts.gameVersion) || null;
    if (!Array.isArray(docs)) throw new Error('normalizeDocs: expected the parsed Docs.json array');

    // Items: any class named Desc_*_C with a display name.
    const itemForms = new Map();
    const items = {};
    for (const group of docs) {
      for (const cls of group.Classes) {
        const cn = cls.ClassName;
        if (!cn || cn.indexOf('Desc_') !== 0 || !cls.mDisplayName) continue;
        itemForms.set(cn, cls.mForm);
        items[cn] = { name: cls.mDisplayName, form: normForm(cls.mForm) };
      }
    }

    // Buildings (manufacturers) we can place recipes in.
    const buildings = {};
    for (const groupName of MANUFACTURER_GROUPS) {
      for (const cls of groupClasses(docs, groupName)) {
        buildings[cls.ClassName] = { name: cls.mDisplayName, power: Number(cls.mPowerConsumption) || 0 };
      }
    }

    // Recipes producible in one of those buildings.
    const recipes = {};
    for (const r of groupClasses(docs, 'FGRecipe')) {
      const producedIn = parseProducedIn(r.mProducedIn);
      const building = producedIn.find((b) => buildings[b]);
      if (!building) continue;

      const outputs = parseItemAmounts(r.mProduct, itemForms);
      if (outputs.length === 0) continue;

      // Alternate recipes are tagged in the game by class/name; we flag them so
      // the UI can suppress them from the main list but still offer them as
      // variants for whatever they produce.
      const alternate = r.ClassName.indexOf('Recipe_Alternate') === 0 || /^Alternate:/.test(r.mDisplayName || '');

      recipes[r.ClassName] = {
        name: r.mDisplayName,
        time: Number(r.mManufactoringDuration) || 0,
        building,
        alternate,
        inputs: parseItemAmounts(r.mIngredients, itemForms),
        outputs,
      };
    }

    return {
      gameVersion,
      schema: 2,
      items: sortedObject(items),
      buildings: sortedObject(buildings),
      recipes: sortedObject(recipes),
    };
  }

  // Wrap a dataset object as a loadable recipes.js (the file:// friendly form):
  // a classic script that registers itself on the BeanCounter global. Shared by
  // tools/import.html and tools/gen-data.js so both emit identical bytes.
  function serializeDataset(dataset) {
    const version = dataset.gameVersion;
    return (
      '// recipes.js — generated dataset for game version ' + version + '. Do not hand-edit.\n' +
      '// Regenerate via tools/import.html (browser) or: node tools/gen-data.js ' + version + '\n' +
      '(function (BC) {\n' +
      '  BC.datasets = BC.datasets || {};\n' +
      '  BC.datasets[' + JSON.stringify(version) + '] = ' +
      JSON.stringify(dataset, null, 1).replace(/\n/g, '\n  ') + ';\n' +
      '})(globalThis.BeanCounter = globalThis.BeanCounter || {});\n'
    );
  }

  return { normalizeDocs, serializeDataset };
});
