// calculator.js — deterministic production math. No DOM, no I/O.
//
// Classic script: hangs its API off the single `BeanCounter` global so it loads
// over file:// (no ES modules). Also CommonJS-exports for the Node test runner.
//
// MVP scope: single-recipe rate calculation. Given a recipe and a desired output
// rate of its primary product, work out machine count and the resulting flows +
// power. Recursive full-chain solving will build on these primitives.
(function (BC) {
  'use strict';

  const PER_MINUTE = 60;

  // Per-minute throughput of one machine at 100% clock.
  function perMachineRates(recipe) {
    const scale = (e) => ({ item: e.item, rate: e.amount * (PER_MINUTE / recipe.time) });
    return { inputs: recipe.inputs.map(scale), outputs: recipe.outputs.map(scale) };
  }

  // The recipe's primary product (first output) — what a rate target refers to.
  function primaryOutput(recipe) {
    return recipe.outputs[0];
  }

  // Core MVP calculation. targetRate = desired units/min of the primary product.
  function computeRecipePlan(dataset, recipeKey, targetRate) {
    const recipe = dataset.recipes[recipeKey];
    if (!recipe) throw new Error('unknown recipe: ' + recipeKey);

    const per = perMachineRates(recipe);
    const primaryPerMachine = per.outputs[0].rate;
    const machines = primaryPerMachine > 0 ? targetRate / primaryPerMachine : 0;
    const scaleByMachines = (flow) => flow.map((f) => ({ item: f.item, rate: f.rate * machines }));

    const building = dataset.buildings[recipe.building];
    const outputs = scaleByMachines(per.outputs);

    return {
      recipeKey,
      recipeName: recipe.name,
      building: recipe.building,
      buildingName: building ? building.name : recipe.building,
      targetRate,
      machines,
      power: machines * (building ? building.power : 0),
      inputs: scaleByMachines(per.inputs),
      outputs,                       // includes the primary product…
      byproducts: outputs.slice(1),  // …and these are the extras
    };
  }

  BC.calculator = { perMachineRates, primaryOutput, computeRecipePlan };
  if (typeof module === 'object' && module.exports) module.exports = BC.calculator;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
