// engine.test.js — plain assertions for the pure engine. No framework, no
// toolchain. Runs in the browser via tests/index.html and under Node via
// `node tests/engine.test.js` (both import the same ES modules).

import { computeRecipePlan, perMachineRates } from '../src/engine/calculator.js';
import { encodePlan, decodePlan } from '../src/engine/plan-codec.js';

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

export const tests = [
  ['per-machine rate: Iron Ingot = 30/min', () => {
    const r = perMachineRates(dataset.recipes.Recipe_IngotIron_C);
    assertClose(r.outputs[0].rate, 30);
    assertClose(r.inputs[0].rate, 30);
  }],

  ['plan scales machines to hit target', () => {
    const p = computeRecipePlan(dataset, 'Recipe_IngotIron_C', 90);
    assertClose(p.machines, 3);
    assertClose(p.power, 12);
    assertClose(p.inputs[0].rate, 90);
  }],

  ['byproducts are separated from the primary output', () => {
    const p = computeRecipePlan(dataset, 'Recipe_Plastic_C', 20); // 20 plastic/min
    assertClose(p.machines, 1);
    assertEqual(p.byproducts.length, 1);
    assertClose(p.byproducts[0].rate, 10);     // Heavy Oil Residue
    assertClose(p.inputs[0].rate, 30);          // Crude Oil
    assertClose(p.power, 30);
  }],

  ['bookmark round-trips', () => {
    const plan = { version: '1.2', entries: [{ recipeKey: 'Recipe_IngotIron_C', targetRate: 90 }] };
    const back = decodePlan(encodePlan(plan));
    assertEqual(back.version, '1.2');
    assertEqual(back.entries[0].recipeKey, 'Recipe_IngotIron_C');
    assertClose(back.entries[0].targetRate, 90);
  }],

  ['decode rejects a foreign string', () => {
    let threw = false;
    try { decodePlan('not-a-bookmark'); } catch { threw = true; }
    assertEqual(threw, true);
  }],
];

// --- tiny assertion helpers ---
function assertClose(a, b, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`expected ${b}, got ${a}`);
}
function assertEqual(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Node runner (browser uses tests/index.html instead).
if (typeof window === 'undefined') {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.message}`); }
  }
  console.log(failed ? `\n${failed} failing` : `\n${tests.length} passing`);
  if (failed) process.exit(1);
}
