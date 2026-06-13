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
  const { solveChain, sizeFromSupplies, rollUpFactory } = BC.solver;
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
    ['plan can target a byproduct slot; the primary product becomes a byproduct', function () {
      const p = computeRecipePlan(dataset, 'Recipe_Plastic_C', 10, 'Desc_HeavyOilResidue_C');
      assertClose(p.machines, 1);                       // 10/min HOR = 1 machine
      assertEqual(p.byproducts.length, 1);
      assertEqual(p.byproducts[0].item, 'Desc_Plastic_C');
      assertClose(p.byproducts[0].rate, 20);            // host product is now the extra
    }],
    ['bookmark round-trips', function () {
      const plan = { version: '1.2', entries: [{ targetItem: 'Desc_IronIngot_C', targetRate: 90 }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.version, '1.2');
      assertEqual(back.entries[0].targetItem, 'Desc_IronIngot_C');
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

    // --- manufacturable-item picker (items, not recipes) ---
    ['manufacturableItems lists products + byproducts, drops raw and input-only items', function () {
      const items = data.manufacturableItems(solverFixture);
      assertEqual(items.includes('Desc_Widget_C'), true);   // a product
      assertEqual(items.includes('Desc_Slag_C'), true);     // a byproduct is targetable
      assertEqual(items.includes('Desc_Ore_C'), false);     // raw resource, despite a conversion recipe
      // sorted by display name
      assertEqual(items.slice().sort((a, b) => data.itemName(solverFixture, a).localeCompare(data.itemName(solverFixture, b))).join(), items.join());
    }],
    ['recipesOutputting includes byproduct sources; defaultRecipeForItem covers byproduct-only items', function () {
      assertEqual(data.recipesForItem(solverFixture, 'Desc_Slag_C').length, 0);          // no primary recipe
      assertEqual(data.recipesOutputting(solverFixture, 'Desc_Slag_C')[0], 'Recipe_Ingot_C'); // but a byproduct source
      assertEqual(data.defaultRecipeForItem(solverFixture, 'Desc_Slag_C'), 'Recipe_Ingot_C');
      assertEqual(data.recipesOutputting(solverFixture, 'Desc_Ingot_C').includes('Recipe_Alternate_PureIngot_C'), true);
    }],
    ['defaultRecipeForItem skips a recipe that loops back (packaging) for a sane default', function () {
      const fx = {
        gameVersion: 'test',
        items: {
          Desc_F_C: { name: 'F', form: 'liquid' }, Desc_PackagedF_C: { name: 'Packaged F', form: 'solid' },
          Desc_Can_C: { name: 'Can', form: 'solid' }, Desc_Raw_C: { name: 'Raw', form: 'solid', resource: true },
        },
        buildings: { B_C: { name: 'B', power: 1 } },
        recipes: {
          // 'Unpackage F' is a standard recipe → primary-product default, but it loops
          // (its input Packaged F is made from F again).
          Recipe_UnpackageF_C: { name: 'Unpackage F', time: 1, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_PackagedF_C', amount: 1 }], outputs: [{ item: 'Desc_F_C', amount: 1 }, { item: 'Desc_Can_C', amount: 1 }] },
          Recipe_PackageF_C: { name: 'Package F', time: 1, building: 'B_C', alternate: false, inputs: [{ item: 'Desc_F_C', amount: 1 }, { item: 'Desc_Can_C', amount: 1 }], outputs: [{ item: 'Desc_PackagedF_C', amount: 1 }] },
          Recipe_Alternate_RealF_C: { name: 'Alternate: Real F', time: 1, building: 'B_C', alternate: true, inputs: [{ item: 'Desc_Raw_C', amount: 1 }], outputs: [{ item: 'Desc_F_C', amount: 1 }] },
        },
      };
      assertEqual(data.defaultRecipeKey(fx, 'Desc_F_C'), 'Recipe_UnpackageF_C');       // naive primary default loops
      assertEqual(data.defaultRecipeForItem(fx, 'Desc_F_C'), 'Recipe_Alternate_RealF_C'); // target default skips the loop
    }],

    // --- full-chain solver ---
    ['solver aggregates a shared intermediate (diamond)', function () {
      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1);
      const ingot = sol.steps.find((s) => s.item === 'Desc_Ingot_C');
      assertClose(ingot.rate, 5);        // 2 (plate) + 3 (rod)
      assertClose(ingot.machines, 5);
      assertClose(sol.totals.machines, 11); // 1 widget + 2 plate + 3 rod + 5 ingot
      assertEqual(sol.steps[0].item, 'Desc_Widget_C'); // target listed first
    }],
    ['solver treats raw resources as leaves despite a conversion recipe', function () {
      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1);
      assertEqual(sol.raw.length, 1);
      assertEqual(sol.raw[0].item, 'Desc_Ore_C');
      assertClose(sol.raw[0].rate, 5);
      assertEqual(sol.steps.some((s) => s.item === 'Desc_Ore_C'), false); // never "produced"
    }],
    ['solver reports gross byproducts', function () {
      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1);
      const slag = sol.byproducts.find((b) => b.item === 'Desc_Slag_C');
      assertClose(slag.gross, 5); // 1/craft × 5 ingot machines
      assertClose(slag.surplus, 5); // nothing consumes Slag, so it's all surplus
      assertClose(slag.credited, 0);
      assertEqual(slag.recyclable, false); // not consumed anywhere → can't be reused
    }],
    ['solver tree duplicates shared nodes with per-branch sub-rates', function () {
      const t = solveChain(solverFixture, 'Desc_Widget_C', 1).tree;
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
      const base = solveChain(solverFixture, 'Desc_Widget_C', 1);
      assertEqual(base.raw.some((r) => r.item === 'Desc_Ore_C'), true);     // default: Ore + Slag
      assertEqual(base.byproducts.some((b) => b.item === 'Desc_Slag_C'), true);

      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1, {
        recipeChoices: { Desc_Ingot_C: 'Recipe_Alternate_PureIngot_C' },
      });
      const altOre = sol.raw.find((r) => r.item === 'Desc_AltOre_C');
      assertClose(altOre.rate, 10);  // 5 ingot × 2 Alt Ore
      assertEqual(sol.raw.some((r) => r.item === 'Desc_Ore_C'), false);     // no longer mined
      assertEqual(sol.byproducts.some((b) => b.item === 'Desc_Slag_C'), false); // no byproduct now
    }],
    ['targeting a byproduct scales its host recipe; the host product becomes surplus', function () {
      // Slag is only ever a byproduct of the Ingot recipe (1 Slag + 1 Ingot/craft).
      const sol = solveChain(solverFixture, 'Desc_Slag_C', 5);
      assertEqual(sol.targetItem, 'Desc_Slag_C');
      assertEqual(sol.targetRecipeKey, 'Recipe_Ingot_C');
      assertClose(sol.targetRate, 5);
      assertClose(sol.totals.machines, 5);                                   // 5 Ingot machines make 5 Slag
      const ingot = sol.byproducts.find((b) => b.item === 'Desc_Ingot_C');
      assertClose(ingot.surplus, 5);                                         // host's primary product is surplus
      assertClose(sol.raw.find((r) => r.item === 'Desc_Ore_C').rate, 5);
      assertEqual(sol.tree.isTarget, true);                                  // root node flagged for the broad picker
    }],
    ['the root recipe can be overridden via recipeChoices on the target item', function () {
      const sol = solveChain(solverFixture, 'Desc_Ingot_C', 1, {
        recipeChoices: { Desc_Ingot_C: 'Recipe_Alternate_PureIngot_C' },
      });
      assertEqual(sol.targetRecipeKey, 'Recipe_Alternate_PureIngot_C');
      assertClose(sol.raw.find((r) => r.item === 'Desc_AltOre_C').rate, 2);  // 1 ingot × 2 Alt Ore
      assertEqual(sol.byproducts.some((b) => b.item === 'Desc_Slag_C'), false); // pure recipe, no Slag
    }],

    // --- byproduct crediting ---
    ['recycling a byproduct fluid offsets raw draw, leaving surplus', function () {
      const gross = solveChain(recycleRawFixture, 'Desc_A_C', 1);
      const w0 = gross.byproducts.find((b) => b.item === 'Desc_W_C');
      assertClose(w0.gross, 3); assertClose(w0.surplus, 3); assertClose(w0.credited, 0);
      assertEqual(w0.fluid, true);
      assertClose(gross.raw.find((r) => r.item === 'Desc_W_C').rate, 2); // 2/min drawn

      const sol = solveChain(recycleRawFixture, 'Desc_A_C', 1, { recycle: ['Desc_W_C'] });
      const w = sol.byproducts.find((b) => b.item === 'Desc_W_C');
      assertClose(w.gross, 3); assertClose(w.credited, 2); assertClose(w.surplus, 1);
      assertClose(sol.raw.find((r) => r.item === 'Desc_W_C').rate, 0); // fully covered by byproduct
    }],
    ['recycling a produced byproduct zeroes its own step', function () {
      const gross = solveChain(recycleProdFixture, 'Desc_P_C', 1);
      assertClose(gross.steps.find((s) => s.item === 'Desc_B_C').machines, 1); // 1 machine making B
      assertClose(gross.raw.find((r) => r.item === 'Desc_R_C').rate, 1);
      assertClose(gross.byproducts.find((b) => b.item === 'Desc_B_C').surplus, 2);

      const sol = solveChain(recycleProdFixture, 'Desc_P_C', 1, { recycle: ['Desc_B_C'] });
      const bStep = sol.steps.find((s) => s.item === 'Desc_B_C');
      assertClose(bStep.machines, 0);          // demand fully met by the byproduct
      assertEqual(bStep.recyclable, true);     // step kept so the toggle stays reachable
      assertEqual(sol.raw.some((r) => r.item === 'Desc_R_C'), false); // nothing mined for B
      const b = sol.byproducts.find((x) => x.item === 'Desc_B_C');
      assertClose(b.credited, 1); assertClose(b.surplus, 1);
    }],
    ['tree nodes carry recycle flags (toggle lives on the tree)', function () {
      const sol = solveChain(recycleProdFixture, 'Desc_P_C', 1, { recycle: ['Desc_B_C'] });
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
      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1, { provided: ['Desc_Ingot_C'] });
      assertEqual(sol.lineInputs.length, 1);
      assertEqual(sol.lineInputs[0].item, 'Desc_Ingot_C');
      assertClose(sol.lineInputs[0].rate, 5);                    // 2 (plate) + 3 (rod)
      assertEqual(sol.steps.some((s) => s.item === 'Desc_Ingot_C'), false);
      assertClose(sol.totals.machines, 6);                       // Widget + Plate + Rod, no Ingot
      assertEqual(sol.raw.length, 0);                            // Ore was only for Ingot
      assertEqual(sol.byproducts.length, 0);                     // Slag came from the Ingot recipe
    }],
    ['a provided item is credited like raw (byproduct offsets the import)', function () {
      const plain = solveChain(recycleProdFixture, 'Desc_P_C', 1, { provided: ['Desc_B_C'] });
      assertClose(plain.lineInputs.find((i) => i.item === 'Desc_B_C').rate, 1); // Q needs 1 B, imported
      assertEqual(plain.raw.some((r) => r.item === 'Desc_R_C'), false);         // B no longer built here
      assertClose(plain.byproducts.find((b) => b.item === 'Desc_B_C').surplus, 2); // uncredited

      const sol = solveChain(recycleProdFixture, 'Desc_P_C', 1, { provided: ['Desc_B_C'], recycle: ['Desc_B_C'] });
      assertClose(sol.lineInputs.find((i) => i.item === 'Desc_B_C').rate, 0);   // byproduct covers the import
      const b = sol.byproducts.find((x) => x.item === 'Desc_B_C');
      assertClose(b.credited, 1); assertClose(b.surplus, 1);
    }],
    ['tree annotates provided leaves and which nodes can be provided', function () {
      const sol = solveChain(solverFixture, 'Desc_Widget_C', 1, { provided: ['Desc_Ingot_C'] });
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
      const plan = { version: '1.2', entries: [{ targetItem: 'Desc_W_C', targetRate: 60, choiceKeys: ['Recipe_A_C', 'Recipe_B_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].choiceKeys.length, 2);
      assertEqual(back.entries[0].choiceKeys[0], 'Recipe_A_C');
    }],
    ['bookmark without choices decodes to empty lists', function () {
      const back = decodePlan(encodePlan({ version: '1.2', entries: [{ targetItem: 'Desc_W_C', targetRate: 1 }] }));
      assertEqual(back.entries[0].choiceKeys.length, 0);
      assertEqual(back.entries[0].recycleItems.length, 0);
      assertEqual(back.entries[0].providedItems.length, 0);
    }],
    ['bookmark round-trips a non-default rootRecipe (alt or byproduct source)', function () {
      const plan = { version: '1.2', entries: [{ targetItem: 'Desc_W_C', rootRecipe: 'Recipe_AltW_C', targetRate: 1 }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].targetItem, 'Desc_W_C');
      assertEqual(back.entries[0].rootRecipe, 'Recipe_AltW_C');
    }],
    ['old recipe-only bookmark decodes with no targetItem (UI derives it)', function () {
      // Pre-item bookmarks carried only the root recipe; decode keeps it so the UI
      // can map it back to an item.
      const back = decodePlan(encodePlan({ version: '1.2', entries: [{ rootRecipe: 'Recipe_W_C', targetRate: 1 }] }));
      assertEqual(back.entries[0].rootRecipe, 'Recipe_W_C');
      assertEqual(back.entries[0].targetItem, undefined);
    }],
    ['bookmark round-trips recycleItems', function () {
      const plan = { version: '1.2', entries: [{ targetItem: 'Desc_A_C', targetRate: 1, recycleItems: ['Desc_W_C', 'Desc_B_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].recycleItems.length, 2);
      assertEqual(back.entries[0].recycleItems[0], 'Desc_W_C');
    }],
    ['bookmark round-trips providedItems', function () {
      const plan = { version: '1.2', entries: [{ targetItem: 'Desc_A_C', targetRate: 1, providedItems: ['Desc_X_C'] }] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].providedItems.length, 1);
      assertEqual(back.entries[0].providedItems[0], 'Desc_X_C');
    }],
    ['bookmark round-trips a multi-line plan (one per entry)', function () {
      const plan = { version: '1.2', entries: [
        { targetItem: 'Desc_A_C', targetRate: 60, choiceKeys: ['Recipe_X_C'] },
        { targetItem: 'Desc_B_C', targetRate: 30, recycleItems: ['Desc_W_C'] },
        { targetItem: 'Desc_C_C', targetRate: 15, providedItems: ['Desc_Y_C'] },
      ] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries.length, 3);
      assertEqual(back.entries[0].targetItem, 'Desc_A_C');
      assertEqual(back.entries[0].choiceKeys[0], 'Recipe_X_C');
      assertClose(back.entries[1].targetRate, 30);
      assertEqual(back.entries[1].recycleItems[0], 'Desc_W_C');
      assertEqual(back.entries[2].providedItems[0], 'Desc_Y_C');
    }],

    // --- supply-driven sizing (forward from a supply) ---
    ['reachableFrom lists forward-reachable products, minus the source and raws', function () {
      const r = data.reachableFrom(solverFixture, 'Desc_Ore_C');
      assertEqual(r.includes('Desc_Widget_C'), true);
      assertEqual(r.includes('Desc_Ingot_C'), true);
      assertEqual(r.includes('Desc_Slag_C'), true);
      assertEqual(r.includes('Desc_Ore_C'), false);    // the source itself is excluded
      assertEqual(r.includes('Desc_AltOre_C'), false); // a raw, and nothing outputs it
      // a downstream supply has a smaller forward frontier
      const rp = data.reachableFrom(solverFixture, 'Desc_Plate_C');
      assertEqual(rp.includes('Desc_Widget_C'), true); // Plate → Widget
      assertEqual(rp.includes('Desc_Ingot_C'), false); // Ingot is upstream of Plate, not reachable
    }],
    // The list must match what the solver can actually build from the supply: it
    // follows real production edges only, never a recipe's *byproduct* or a
    // resource-conversion output. Reaching those flooded the list with items the
    // chain doesn't really draw the supply for (e.g. bauxite → AI Limiters).
    ['reachableFrom does not leak through byproducts or resource conversions', function () {
      const f = {
        gameVersion: 'test',
        items: {
          Desc_Src_C: { name: 'Src', form: 'solid', resource: true },
          Desc_Main_C: { name: 'Main', form: 'solid' },     // primary product of Src
          Desc_BP_C: { name: 'Byprod', form: 'solid' },     // byproduct of the Src recipe
          Desc_Far_C: { name: 'Far', form: 'solid' },        // made from the byproduct only
          Desc_OtherRaw_C: { name: 'Other Raw', form: 'solid', resource: true },
        },
        buildings: { B_C: { name: 'M', power: 1 } },
        recipes: {
          // Src → Main (+ Byprod byproduct).
          Recipe_Main_C: { name: 'Main', time: 60, building: 'B_C', inputs: [{ item: 'Desc_Src_C', amount: 1 }], outputs: [{ item: 'Desc_Main_C', amount: 1 }, { item: 'Desc_BP_C', amount: 1 }] },
          // Far is reachable only through the byproduct — must NOT be offered.
          Recipe_Far_C: { name: 'Far', time: 60, building: 'B_C', inputs: [{ item: 'Desc_BP_C', amount: 1 }], outputs: [{ item: 'Desc_Far_C', amount: 1 }] },
          // Resource-conversion: Main → the raw Other Raw. Must not propagate.
          Recipe_Convert_C: { name: 'Other Raw (Main)', time: 60, building: 'B_C', inputs: [{ item: 'Desc_Main_C', amount: 1 }], outputs: [{ item: 'Desc_OtherRaw_C', amount: 1 }] },
        },
      };
      const r = data.reachableFrom(f, 'Desc_Src_C');
      assertEqual(r.includes('Desc_Main_C'), true);  // real primary product of the supply
      assertEqual(r.includes('Desc_BP_C'), true);    // a byproduct of a supply recipe is still targetable
      assertEqual(r.includes('Desc_Far_C'), false);  // reachable only via the byproduct → excluded
      assertEqual(r.includes('Desc_OtherRaw_C'), false); // a raw conversion output → excluded
    }],
    ['inputItems lists consumed items (incl. raws), excludes never-consumed products', function () {
      const ins = data.inputItems(solverFixture);
      assertEqual(ins.includes('Desc_Ore_C'), true);     // a raw, but consumed → a valid supply
      assertEqual(ins.includes('Desc_Ingot_C'), true);
      assertEqual(ins.includes('Desc_Widget_C'), false); // nothing consumes Widget
    }],
    ['sizeFromSupplies sizes the output to the binding supply, consuming it fully', function () {
      const plan = sizeFromSupplies(solverFixture, 'Desc_Widget_C', [{ item: 'Desc_Ore_C', rate: 50 }]);
      assertClose(plan.sizing.targetRate, 10);    // 50 Ore ÷ 5 Ore-per-Widget
      assertEqual(plan.sizing.binding, 'Desc_Ore_C');
      assertEqual(plan.sizing.unbound, false);
      assertClose(plan.targetRate, 10);
      // the supply is the chain boundary → it surfaces as a line input, fully drawn
      assertClose(plan.lineInputs.find((r) => r.item === 'Desc_Ore_C').rate, 50);
      assertEqual(plan.raw.some((r) => r.item === 'Desc_Ore_C'), false);
      assertClose(plan.sizing.supplies[0].slack, 0, 1e-6);
    }],
    ['sizeFromSupplies flags an unbound path (chosen recipe ignores the supply)', function () {
      // Widget via the Pure Ingot path draws Alt Ore, not Ore — so an Ore supply binds nothing.
      const plan = sizeFromSupplies(solverFixture, 'Desc_Widget_C', [{ item: 'Desc_Ore_C', rate: 50 }],
        { recipeChoices: { Desc_Ingot_C: 'Recipe_Alternate_PureIngot_C' } });
      assertEqual(plan.sizing.unbound, true);
      assertClose(plan.sizing.targetRate, 0);
    }],
    ['bookmark round-trips a supply-driven line; rate lines default to driver "rate"', function () {
      const plan = { version: '1.2', entries: [
        { targetItem: 'Desc_Fuel_C', targetRate: 26.7, driver: 'supply', sourceItem: 'Desc_HOR_C', supplyRate: 40 },
        { targetItem: 'Desc_W_C', targetRate: 1 },
      ] };
      const back = decodePlan(encodePlan(plan));
      assertEqual(back.entries[0].driver, 'supply');
      assertEqual(back.entries[0].sourceItem, 'Desc_HOR_C');
      assertClose(back.entries[0].supplyRate, 40);
      assertEqual(back.entries[1].driver, 'rate');       // absent flag → rate-driven
      assertEqual(back.entries[1].sourceItem, undefined);
    }],

    // --- Advanced Game Settings global multipliers (recipe cost, machine power) ---
    ['applyModifiers scales inputs (solids round up, fluids exact) + power, leaving outputs & original untouched', function () {
      const f = {
        gameVersion: 'test',
        items: {
          Desc_Part_C: { name: 'Part', form: 'solid' },
          Desc_Goo_C: { name: 'Goo', form: 'liquid' },
          Desc_Thing_C: { name: 'Thing', form: 'solid' },
        },
        buildings: { B_C: { name: 'M', power: 10 } },
        recipes: {
          Recipe_Thing_C: { name: 'Thing', time: 60, building: 'B_C',
            inputs: [{ item: 'Desc_Part_C', amount: 10 }, { item: 'Desc_Goo_C', amount: 2.5 }],
            outputs: [{ item: 'Desc_Thing_C', amount: 1 }] },
        },
      };
      const cheap = data.applyModifiers(f, { costMult: 0.25, powerMult: 0.5 });
      assertClose(cheap.recipes.Recipe_Thing_C.inputs[0].amount, 3);     // solid: ceil(10×0.25=2.5) = 3
      assertClose(cheap.recipes.Recipe_Thing_C.inputs[1].amount, 0.625); // fluid: 2.5×0.25 exact, no rounding
      assertClose(cheap.recipes.Recipe_Thing_C.outputs[0].amount, 1);    // outputs never scaled
      assertClose(cheap.buildings.B_C.power, 5);                          // 10×0.5
      const dear = data.applyModifiers(f, { costMult: 2, powerMult: 5 });
      assertClose(dear.recipes.Recipe_Thing_C.inputs[0].amount, 20);     // 10×2
      assertClose(dear.recipes.Recipe_Thing_C.inputs[1].amount, 5);      // 2.5×2 exact
      assertClose(dear.buildings.B_C.power, 50);                          // 10×5
      assertEqual(data.applyModifiers(f, { costMult: 1, powerMult: 1 }), f); // identity → same object
      assertClose(f.recipes.Recipe_Thing_C.inputs[0].amount, 10);        // original untouched
      assertClose(f.buildings.B_C.power, 10);
    }],
    ['solveChain on a cost-multiplied dataset draws proportionally more raw', function () {
      const base = solveChain(solverFixture, 'Desc_Ingot_C', 60);
      const scaled = solveChain(data.applyModifiers(solverFixture, { costMult: 2 }), 'Desc_Ingot_C', 60);
      assertEqual(base.raw.length, 1);
      assertEqual(scaled.raw[0].item, base.raw[0].item);     // same raw, just more of it
      assertClose(scaled.raw[0].rate, base.raw[0].rate * 2); // ×2 cost → 2× the input draw
    }],
    ['solveChain on a power-multiplied dataset scales total power', function () {
      const base = solveChain(solverFixture, 'Desc_Ingot_C', 60);
      const scaled = solveChain(data.applyModifiers(solverFixture, { powerMult: 5 }), 'Desc_Ingot_C', 60);
      assertClose(scaled.totals.power, base.totals.power * 5);
    }],
    ['bookmark round-trips the global multipliers, defaulting to 1 when absent', function () {
      const back = decodePlan(encodePlan({ version: '1.2', costMult: 0.25, powerMult: 5,
        entries: [{ targetItem: 'Desc_W_C', targetRate: 1 }] }));
      assertClose(back.costMult, 0.25);
      assertClose(back.powerMult, 5);
      const plain = decodePlan(encodePlan({ version: '1.2', entries: [{ targetItem: 'Desc_W_C', targetRate: 1 }] }));
      assertClose(plain.costMult, 1);   // old/absent → default 1
      assertClose(plain.powerMult, 1);
    }],

    // --- factory roll-up (multiple lines) ---
    ['roll-up routes one line\'s output to another\'s input; sums totals', function () {
      // Line 0 makes Ingot (from Ore); line 1 makes Widget needing 5 Ingot externally.
      const ingotLine = { target: 'Desc_Ingot_C', supplies: [{ item: 'Desc_Ingot_C', rate: 5 }], demands: [], raw: [{ item: 'Desc_Ore_C', rate: 5 }], power: 5, machines: 5, byBuilding: { B_C: 5 } };
      const widgetLine = { target: 'Desc_Widget_C', supplies: [{ item: 'Desc_Widget_C', rate: 1 }], demands: [{ item: 'Desc_Ingot_C', rate: 5 }], raw: [], power: 6, machines: 6, byBuilding: { B_C: 6 } };
      const roll = rollUpFactory(solverFixture, [ingotLine, widgetLine]);

      assertEqual(roll.routes.length, 1);
      assertEqual(roll.routes[0].item, 'Desc_Ingot_C');
      assertEqual(roll.routes[0].from, 0);
      assertEqual(roll.routes[0].to, 1);
      assertClose(roll.routes[0].rate, 5);
      assertEqual(roll.unmet.length, 0);                 // Ingot demand met internally
      assertClose(roll.machines, 11);
      assertClose(roll.power, 11);
      assertClose(roll.byBuilding.B_C, 11);
      assertClose(roll.raw.find((r) => r.item === 'Desc_Ore_C').rate, 5);
      const widget = roll.outputs.find((o) => o.item === 'Desc_Widget_C');
      assertClose(widget.rate, 1); assertEqual(widget.product, true);
      assertEqual(roll.outputs.some((o) => o.item === 'Desc_Ingot_C'), false); // net 0, not an output
    }],
    ['roll-up flags an input no line supplies as required externally', function () {
      const widgetLine = { target: 'Desc_Widget_C', supplies: [{ item: 'Desc_Widget_C', rate: 1 }], demands: [{ item: 'Desc_Ingot_C', rate: 5 }], raw: [], power: 6, machines: 6, byBuilding: { B_C: 6 } };
      const roll = rollUpFactory(solverFixture, [widgetLine]);
      assertEqual(roll.routes.length, 0);
      assertEqual(roll.unmet.length, 1);
      assertEqual(roll.unmet[0].item, 'Desc_Ingot_C');
      assertClose(roll.unmet[0].rate, 5);
    }],
    ['roll-up routes a byproduct surplus to another line, leaving surplus an output', function () {
      // Line 0 makes P and 2 B as surplus byproduct; line 1 makes Q needing 1 B.
      const pLine = { target: 'Desc_P_C', supplies: [{ item: 'Desc_P_C', rate: 1 }, { item: 'Desc_B_C', rate: 2 }], demands: [], raw: [{ item: 'Desc_R_C', rate: 1 }], power: 2, machines: 2, byBuilding: { B_C: 2 } };
      const qLine = { target: 'Desc_Q_C', supplies: [{ item: 'Desc_Q_C', rate: 1 }], demands: [{ item: 'Desc_B_C', rate: 1 }], raw: [], power: 1, machines: 1, byBuilding: { B_C: 1 } };
      const roll = rollUpFactory(recycleProdFixture, [pLine, qLine]);

      const route = roll.routes.find((r) => r.item === 'Desc_B_C');
      assertEqual(route.from, 0); assertEqual(route.to, 1); assertClose(route.rate, 1);
      const bOut = roll.outputs.find((o) => o.item === 'Desc_B_C');
      assertClose(bOut.rate, 1);              // 2 produced − 1 consumed
      assertEqual(bOut.product, false);       // B is a byproduct, not any line's target
      assertEqual(roll.unmet.length, 0);
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
