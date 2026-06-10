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
    // The chain's per-step selector keys off recipesForItem(<item>); guard that
    // it returns the whole group for an item key (a recipe key must NOT be passed).
    ['recipesForItem returns all variants for an item key', function () {
      assertEqual(data.recipesForItem(altFixture, 'Desc_IronIngot_C').length, 3);
      assertEqual(data.recipesForItem(altFixture, 'Recipe_IngotIron_C').length, 0); // recipe key -> not an item
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
      assertClose(slag.gross, 5); // 1/craft × 5 ingot machines
      assertClose(slag.surplus, 5); // nothing consumes Slag, so it's all surplus
      assertClose(slag.credited, 0);
      assertEqual(slag.recyclable, false); // not consumed anywhere → can't be reused
    }],
    ['solver tree duplicates shared nodes with per-branch sub-rates', function () {
      const t = solveChain(solverFixture, 'Recipe_Widget_C', 1).tree;
      assertEqual(t.item, 'Desc_Widget_C');
      assertClose(t.rate, 1);
      assertEqual(t.children.length, 2); // Plate + Rod branches
      let ingots = 0, oreRaw = 0;
      (function walk(n) {
        if (n.item === 'Desc_Ingot_C') ingots++;
        if (n.item === 'Desc_Ore_C' && n.raw) oreRaw++;
        (n.children || []).forEach(walk);
      })(t);
      assertEqual(ingots, 2);  // Ingot appears under both branches
      assertEqual(oreRaw, 2);  // raw Ore is a leaf in both
    }],
    ['per-step recipe override changes the chain', function () {
      const base = solveChain(solverFixture, 'Recipe_Widget_C', 1);
      assertEqual(base.raw.some((r) => r.item === 'Desc_Ore_C'), true);     // default: Ore + Slag
      assertEqual(base.byproducts.some((b) => b.item === 'Desc_Slag_C'), true);

      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1, {
        recipeChoices: { Desc_Ingot_C: 'Recipe_Alternate_PureIngot_C' },
      });
      const altOre = sol.raw.find((r) => r.item === 'Desc_AltOre_C');
      assertClose(altOre.rate, 10);  // 5 ingot × 2 Alt Ore
      assertEqual(sol.raw.some((r) => r.item === 'Desc_Ore_C'), false);     // no longer mined
      assertEqual(sol.byproducts.some((b) => b.item === 'Desc_Slag_C'), false); // no byproduct now
    }],

    // --- byproduct crediting ---
    ['recycling a byproduct fluid offsets raw draw, leaving surplus', function () {
      const gross = solveChain(recycleRawFixture, 'Recipe_A_C', 1);
      const w0 = gross.byproducts.find((b) => b.item === 'Desc_W_C');
      assertClose(w0.gross, 3); assertClose(w0.surplus, 3); assertClose(w0.credited, 0);
      assertEqual(w0.fluid, true);
      assertClose(gross.raw.find((r) => r.item === 'Desc_W_C').rate, 2); // 2/min drawn

      const sol = solveChain(recycleRawFixture, 'Recipe_A_C', 1, { recycle: ['Desc_W_C'] });
      const w = sol.byproducts.find((b) => b.item === 'Desc_W_C');
      assertClose(w.gross, 3); assertClose(w.credited, 2); assertClose(w.surplus, 1);
      assertClose(sol.raw.find((r) => r.item === 'Desc_W_C').rate, 0); // fully covered by byproduct
    }],
    ['recycling a produced byproduct zeroes its own step', function () {
      const gross = solveChain(recycleProdFixture, 'Recipe_P_C', 1);
      assertClose(gross.steps.find((s) => s.item === 'Desc_B_C').machines, 1); // 1 machine making B
      assertClose(gross.raw.find((r) => r.item === 'Desc_R_C').rate, 1);
      assertClose(gross.byproducts.find((b) => b.item === 'Desc_B_C').surplus, 2);

      const sol = solveChain(recycleProdFixture, 'Recipe_P_C', 1, { recycle: ['Desc_B_C'] });
      const bStep = sol.steps.find((s) => s.item === 'Desc_B_C');
      assertClose(bStep.machines, 0);          // demand fully met by the byproduct
      assertEqual(bStep.recyclable, true);     // step kept so the toggle stays reachable
      assertEqual(sol.raw.some((r) => r.item === 'Desc_R_C'), false); // nothing mined for B
      const b = sol.byproducts.find((x) => x.item === 'Desc_B_C');
      assertClose(b.credited, 1); assertClose(b.surplus, 1);
    }],
    ['tree nodes carry recycle flags (toggle lives on the tree)', function () {
      const sol = solveChain(recycleProdFixture, 'Recipe_P_C', 1, { recycle: ['Desc_B_C'] });
      let bNode = null, pNode = null;
      (function walk(n) {
        if (n.item === 'Desc_B_C' && !bNode) bNode = n;
        if (n.item === 'Desc_P_C') pNode = n;
        (n.children || []).forEach(walk);
      })(sol.tree);
      assertEqual(bNode.recyclable, true);   // B has a byproduct source
      assertEqual(bNode.recycling, true);    // and it's toggled on
      assertEqual(pNode.recyclable, false);  // P (target) is nobody's byproduct
    }],

    // --- external-input boundary cut ---
    ['providing an item turns it into a line input and cuts its sub-chain', function () {
      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1, { provided: ['Desc_Ingot_C'] });
      assertEqual(sol.lineInputs.length, 1);
      assertEqual(sol.lineInputs[0].item, 'Desc_Ingot_C');
      assertClose(sol.lineInputs[0].rate, 5);                    // 2 (plate) + 3 (rod)
      assertEqual(sol.steps.some((s) => s.item === 'Desc_Ingot_C'), false);
      assertClose(sol.totals.machines, 6);                       // Widget + Plate + Rod, no Ingot
      assertEqual(sol.raw.length, 0);                            // Ore was only for Ingot
      assertEqual(sol.byproducts.length, 0);                     // Slag came from the Ingot recipe
    }],
    ['a provided item is credited like raw (byproduct offsets the import)', function () {
      const plain = solveChain(recycleProdFixture, 'Recipe_P_C', 1, { provided: ['Desc_B_C'] });
      assertClose(plain.lineInputs.find((i) => i.item === 'Desc_B_C').rate, 1); // Q needs 1 B, imported
      assertEqual(plain.raw.some((r) => r.item === 'Desc_R_C'), false);         // B no longer built here
      assertClose(plain.byproducts.find((b) => b.item === 'Desc_B_C').surplus, 2); // uncredited

      const sol = solveChain(recycleProdFixture, 'Recipe_P_C', 1, { provided: ['Desc_B_C'], recycle: ['Desc_B_C'] });
      assertClose(sol.lineInputs.find((i) => i.item === 'Desc_B_C').rate, 0);   // byproduct covers the import
      const b = sol.byproducts.find((x) => x.item === 'Desc_B_C');
      assertClose(b.credited, 1); assertClose(b.surplus, 1);
    }],
    ['tree annotates provided leaves and which nodes can be provided', function () {
      const sol = solveChain(solverFixture, 'Recipe_Widget_C', 1, { provided: ['Desc_Ingot_C'] });
      let ingot = null, widget = null, oreSeen = false;
      (function walk(n) {
        if (n.item === 'Desc_Ingot_C' && !ingot) ingot = n;
        if (n.item === 'Desc_Widget_C') widget = n;
        if (n.item === 'Desc_Ore_C') oreSeen = true;
        (n.children || []).forEach(walk);
      })(sol.tree);
      assertEqual(ingot.provided, true);
      assertEqual(!!ingot.children, false);   // sub-chain stops at the provided node
      assertEqual(ingot.canProvide, true);
      assertEqual(widget.canProvide, false);  // the target can't be sourced externally
      assertEqual(oreSeen, false);            // Ore is below the cut, so it's gone from the tree
    }],

    // --- bookmark carries deep choices ---
    ['bookmark round-trips with choiceKeys', function () {
      const plan = { version: '1.2', entries: [{ recipeKey: 'Recipe_W_C', targetRate: 60, choiceKeys: ['Recipe_A_C', 'Recipe_B_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].choiceKeys.length, 2);
      assertEqual(back.entries[0].choiceKeys[0], 'Recipe_A_C');
    }],
    ['bookmark without choices decodes to empty lists', function () {
      const back = decodePlan(encodePlan({ version: '1.2', entries: [{ recipeKey: 'Recipe_W_C', targetRate: 1 }] }));
      assertEqual(back.entries[0].choiceKeys.length, 0);
      assertEqual(back.entries[0].recycleItems.length, 0);
      assertEqual(back.entries[0].providedItems.length, 0);
    }],
    ['bookmark round-trips recycleItems', function () {
      const plan = { version: '1.2', entries: [{ recipeKey: 'Recipe_A_C', targetRate: 1, recycleItems: ['Desc_W_C', 'Desc_B_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].recycleItems.length, 2);
      assertEqual(back.entries[0].recycleItems[0], 'Desc_W_C');
    }],
    ['bookmark round-trips providedItems', function () {
      const plan = { version: '1.2', entries: [{ recipeKey: 'Recipe_A_C', targetRate: 1, providedItems: ['Desc_X_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].providedItems.length, 1);
      assertEqual(back.entries[0].providedItems[0], 'Desc_X_C');
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
      Desc_AltOre_C: { name: 'Alt Ore', form: 'solid', resource: true },
    },
    buildings: { B_C: { name: 'Machine', power: 1 } },
    recipes: {
      Recipe_Widget_C: { name: 'Widget', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Plate_C', amount: 2 }, { item: 'Desc_Rod_C', amount: 3 }], outputs: [{ item: 'Desc_Widget_C', amount: 1 }] },
      Recipe_Plate_C: { name: 'Plate', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Plate_C', amount: 1 }] },
      Recipe_Rod_C: { name: 'Rod', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Rod_C', amount: 1 }] },
      Recipe_Ingot_C: { name: 'Ingot', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ore_C', amount: 1 }], outputs: [{ item: 'Desc_Ingot_C', amount: 1 }, { item: 'Desc_Slag_C', amount: 1 }] },
      // An alternate way to make Ingot (from Alt Ore, no Slag byproduct).
      Recipe_Alternate_PureIngot_C: { name: 'Alternate: Pure Ingot', time: 60, building: 'B_C', alternate: true, inputs: [{ item: 'Desc_AltOre_C', amount: 2 }], outputs: [{ item: 'Desc_Ingot_C', amount: 1 }] },
      // A conversion recipe producing the raw Ore — must be ignored by default.
      Recipe_ConvertOre_C: { name: 'Ore (Ingot)', time: 60, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_Ingot_C', amount: 1 }], outputs: [{ item: 'Desc_Ore_C', amount: 1 }] },
    },
  };

  // A (target) needs C + Water; making C yields Water as a fluid byproduct, so
  // recycling Water credits it against the Water draw. (All recipes 60s.)
  const recycleRawFixture = {
    gameVersion: 'test',
    items: {
      Desc_A_C: { name: 'A', form: 'solid' },
      Desc_C_C: { name: 'C', form: 'solid' },
      Desc_W_C: { name: 'Water', form: 'liquid', resource: true },
      Desc_R_C: { name: 'R', form: 'solid', resource: true },
    },
    buildings: { B_C: { name: 'Machine', power: 1 } },
    recipes: {
      Recipe_A_C: { name: 'A', time: 60, building: 'B_C', inputs: [{ item: 'Desc_C_C', amount: 1 }, { item: 'Desc_W_C', amount: 2 }], outputs: [{ item: 'Desc_A_C', amount: 1 }] },
      Recipe_C_C: { name: 'C', time: 60, building: 'B_C', inputs: [{ item: 'Desc_R_C', amount: 1 }], outputs: [{ item: 'Desc_C_C', amount: 1 }, { item: 'Desc_W_C', amount: 3 }] },
    },
  };

  // P (target) makes B as a byproduct; B is also needed to make Q (which P needs)
  // and otherwise produced from raw R. Recycling B lets the byproduct cover the
  // demand, zeroing B's own production step. (All recipes 60s.)
  const recycleProdFixture = {
    gameVersion: 'test',
    items: {
      Desc_P_C: { name: 'P', form: 'solid' },
      Desc_Q_C: { name: 'Q', form: 'solid' },
      Desc_B_C: { name: 'B', form: 'solid' },
      Desc_R_C: { name: 'R', form: 'solid', resource: true },
    },
    buildings: { B_C: { name: 'Machine', power: 1 } },
    recipes: {
      Recipe_P_C: { name: 'P', time: 60, building: 'B_C', inputs: [{ item: 'Desc_Q_C', amount: 1 }], outputs: [{ item: 'Desc_P_C', amount: 1 }, { item: 'Desc_B_C', amount: 2 }] },
      Recipe_Q_C: { name: 'Q', time: 60, building: 'B_C', inputs: [{ item: 'Desc_B_C', amount: 1 }], outputs: [{ item: 'Desc_Q_C', amount: 1 }] },
      Recipe_B_C: { name: 'B', time: 60, building: 'B_C', inputs: [{ item: 'Desc_R_C', amount: 1 }], outputs: [{ item: 'Desc_B_C', amount: 1 }] },
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
