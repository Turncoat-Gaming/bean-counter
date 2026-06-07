// engine.test.js — plain assertions for the pure engine. No framework, no
// toolchain. Classic script: runs in the browser via tests/index.html and under
// Node via `node tests/engine.test.js`. Both read the engine API off the shared
// BeanCounter global.
(function () {
  'use strict';

  // Under Node, pull the engine in so it registers on the global. In the browser,
  // index.html has already loaded these via <script> before this file.
  if (typeof require === 'function' && typeof module === 'object') {
    require('../src/engine/calculator.js');
    require('../src/engine/plan-codec.js');
    require('../src/engine/dataset.js');
    require('../src/engine/solver.js');
  }

  const BC = globalThis.BeanCounter;
  const { perMachineRates, computeRecipePlan } = BC.calculator;
  const { encodePlan, decodePlan } = BC.codec;
  const { solveChain } = BC.solver;
  const data = BC.data;

  // A tiny self-contained fixture so tests don't depend on the generated dataset.
  const dataset = {
    gameVersion: 'test',
    items: {
      Desc_OreIron_C: { name: 'Iron Ore', form: 'solid' },
      Desc_IronIngot_C: { name: 'Iron Ingot', form: 'solid' },
      Desc_CrudeOil_C: { name: 'Crude Oil', form: 'liquid' },
      Desc_Plastic_C: { name: 'Plastic', form: 'solid' },
      Desc_HeavyOilResidue_C: { name: 'Heavy Oil Residue', form: 'liquid' },
    },
    buildings: {
      Build_SmelterMk1_C: { name: 'Smelter', power: 4 },
      Build_OilRefinery_C: { name: 'Refinery', power: 30 },
    },
    recipes: {
      Recipe_IngotIron_C: {
        name: 'Iron Ingot', time: 2, building: 'Build_SmelterMk1_C',
        inputs: [{ item: 'Desc_OreIron_C', amount: 1 }],
        outputs: [{ item: 'Desc_IronIngot_C', amount: 1 }],
      },
      Recipe_Plastic_C: {
        name: 'Plastic', time: 6, building: 'Build_OilRefinery_C',
        inputs: [{ item: 'Desc_CrudeOil_C', amount: 3 }],
        outputs: [
          { item: 'Desc_Plastic_C', amount: 2 },
          { item: 'Desc_HeavyOilResidue_C', amount: 1 },
        ],
      },
    },
  };

  function assertClose(a, b, eps) {
    if (Math.abs(a - b) > (eps || 1e-9)) throw new Error('expected ' + b + ', got ' + a);
  }
  function assertEqual(a, b) {
    if (a !== b) throw new Error('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
  }

  const tests = [
    ['per-machine rate: Iron Ingot = 30/min', function () {
      const r = perMachineRates(dataset.recipes.Recipe_IngotIron_C);
      assertClose(r.outputs[0].rate, 30);
      assertClose(r.inputs[0].rate, 30);
    }],
    ['plan scales machines to hit target', function () {
      const p = computeRecipePlan(dataset, 'Recipe_IngotIron_C', 90);
      assertClose(p.machines, 3);
      assertClose(p.power, 12);
      assertClose(p.inputs[0].rate, 90);
    }],
    ['byproducts are separated from the primary output', function () {
      const p = computeRecipePlan(dataset, 'Recipe_Plastic_C', 20);
      assertClose(p.machines, 1);
      assertEqual(p.byproducts.length, 1);
      assertClose(p.byproducts[0].rate, 10);
      assertClose(p.inputs[0].rate, 30);
      assertClose(p.power, 30);
    }],
    ['bookmark round-trips', function () {
      const plan = { version: '1.2', entries: [{ recipeKey: 'Recipe_IngotIron_C', targetRate: 90 }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.version, '1.2');
      assertEqual(back.entries[0].recipeKey, 'Recipe_IngotIron_C');
      assertClose(back.entries[0].targetRate, 90);
    }],
    ['decode rejects a foreign string', function () {
      let threw = false;
      try { decodePlan('not-a-bookmark'); } catch (e) { threw = true; }
      assertEqual(threw, true);
    }],

    // --- alternate-recipe grouping ---
    ['picker hides alternates but keeps orphan-only products', function () {
      const keys = data.pickerRecipes(altFixture).map(([k]) => k);
      assertEqual(keys.includes('Recipe_IngotIron_C'), true);   // standard shown
      assertEqual(keys.includes('Recipe_Alternate_PureIron_C'), false); // alt hidden
      assertEqual(keys.includes('Recipe_CoalIron_C'), true);    // both standards shown
      assertEqual(keys.includes('Recipe_CoalLime_C'), true);
      assertEqual(keys.includes('Recipe_Alternate_PolymerResin_C'), true); // orphan kept
    }],
    ['variants group by product, standard first', function () {
      const v = data.variantsForRecipe(altFixture, 'Recipe_IngotIron_C');
      assertEqual(v.length, 3);
      assertEqual(v[0], 'Recipe_IngotIron_C');          // standard leads
      assertEqual(data.alternateCount(altFixture, 'Recipe_IngotIron_C'), 2);
    }],
    ['representative of an alternate is its standard', function () {
      assertEqual(data.representativeKey(altFixture, 'Recipe_Alternate_PureIron_C'), 'Recipe_IngotIron_C');
      assertEqual(data.representativeKey(altFixture, 'Recipe_CoalLime_C'), 'Recipe_CoalLime_C');
      assertEqual(data.representativeKey(altFixture, 'Recipe_Alternate_PolymerResin_C'), 'Recipe_Alternate_PolymerResin_C');
    }],

    // --- full-chain solver ---
    ['solver aggregates a shared intermediate (diamond)', function () {
      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1);
      const ingot = sol.steps.find((s) => s.item === 'Desc_Ingot_C');
      assertClose(ingot.rate, 5);        // 2 (plate) + 3 (rod)
      assertClose(ingot.machines, 5);
      assertClose(sol.totals.machines, 11); // 1 widget + 2 plate + 3 rod + 5 ingot
      assertEqual(sol.steps[0].item, 'Desc_Widget_C'); // target listed first
    }],
    ['solver treats raw resources as leaves despite a conversion recipe', function () {
      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1);
      assertEqual(sol.raw.length, 1);
      assertEqual(sol.raw[0].item, 'Desc_Ore_C');
      assertClose(sol.raw[0].rate, 5);
      assertEqual(sol.steps.some((s) => s.item === 'Desc_Ore_C'), false); // never "produced"
    }],
    ['solver reports gross byproducts', function () {
      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1);
      const slag = sol.byproducts.find((b) => b.item === 'Desc_Slag_C');
      assertClose(slag.rate, 5); // 1/craft × 5 ingot machines
    }],
  ];

  // Fixture exercising standard+alternate, multi-standard, and orphan-alt cases.
  const altFixture = {
    gameVersion: 'test',
    items: {
      Desc_IronIngot_C: { name: 'Iron Ingot', form: 'solid' },
      Desc_Coal_C: { name: 'Coal', form: 'solid' },
      Desc_PolymerResin_C: { name: 'Polymer Resin', form: 'solid' },
      Desc_X_C: { name: 'X', form: 'solid' },
    },
    buildings: { B_C: { name: 'B', power: 1 } },
    recipes: {
      Recipe_IngotIron_C: { name: 'Iron Ingot', time: 2, building: 'B_C', alternate: false, inputs: [], outputs: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
      Recipe_Alternate_PureIron_C: { name: 'Alternate: Pure Iron Ingot', time: 2, building: 'B_C', alternate: true, inputs: [], outputs: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
      Recipe_Alternate_BasicIron_C: { name: 'Alternate: Basic Iron Ingot', time: 2, building: 'B_C', alternate: true, inputs: [], outputs: [{ item: 'Desc_IronIngot_C', amount: 1 }] },
      Recipe_CoalIron_C: { name: 'Coal (Iron)', time: 2, building: 'B_C', alternate: false, inputs: [], outputs: [{ item: 'Desc_Coal_C', amount: 1 }] },
      Recipe_CoalLime_C: { name: 'Coal (Limestone)', time: 2, building: 'B_C', alternate: false, inputs: [], outputs: [{ item: 'Desc_Coal_C', amount: 1 }] },
      Recipe_Alternate_PolymerResin_C: { name: 'Alternate: Polymer Resin', time: 2, building: 'B_C', alternate: true, inputs: [], outputs: [{ item: 'Desc_PolymerResin_C', amount: 1 }] },
    },
  };

  // Diamond (Widget needs Plate+Rod, both need Ingot), a raw resource with a
  // conversion recipe, and a byproduct (Slag from the Ingot recipe). All recipes
  // are 60s so per-machine = amount/min, keeping the arithmetic obvious.
  const solverFixture = {
    gameVersion: 'test',
    items: {
      Desc_Widget_C: { name: 'Widget', form: 'solid' },
      Desc_Plate_C: { name: 'Plate', form: 'solid' },
      Desc_Rod_C: { name: 'Rod', form: 'solid' },
      Desc_Ingot_C: { name: 'Ingot', form: 'solid' },
      Desc_Slag_C: { name: 'Slag', form: 'solid' },
      Desc_Ore_C: { name: 'Ore', form: 'solid', resource: true },
    },
    buildings: { B_C: { name: 'Machine', power: 1 } },
    recipes: {
      Recipe_Widget_C: { name: 'Widget', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Plate_C', amount: 2 }, { item: 'Desc_Rod_C', amount: 3 }], outputs: [{ item: 'Desc_Widget_C', amount: 1 }] },
      Recipe_Plate_C: { name: 'Plate', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Plate_C', amount: 1 }] },
      Recipe_Rod_C: { name: 'Rod', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Rod_C', amount: 1 }] },
      Recipe_Ingot_C: { name: 'Ingot', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ore_C', amount: 1 }], outputs: [{ item: 'Desc_Ingot_C', amount: 1 }, { item: 'Desc_Slag_C', amount: 1 }] },
      // A conversion recipe producing the raw Ore — must be ignored by default.
      Recipe_ConvertOre_C: { name: 'Ore (Ingot)', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Ore_C', amount: 1 }] },
    },
  };

  BC.tests = tests; // browser runner (tests/index.html) reads this

  // Node runner.
  if (typeof require === 'function' && typeof module === 'object') {
    let failed = 0;
    for (const [name, fn] of tests) {
      try { fn(); console.log('  ok   ' + name); }
      catch (err) { failed++; console.error('  FAIL ' + name + '\n       ' + err.message); }
    }
    console.log(failed ? '\n' + failed + ' failing' : '\n' + tests.length + ' passing');
    if (failed) process.exit(1);
  }
})();
