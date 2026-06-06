// calculator.js — the deterministic production math. No DOM, no I/O.
//
// MVP scope: single-recipe rate calculation. Given a recipe and a desired
// output rate of its primary product, work out how many machines are needed and
// the resulting input/byproduct rates and power draw. Recursive full-chain
// solving comes later and will build on these primitives.

const PER_MINUTE = 60;

// Per-minute throughput of one machine running this recipe at 100% clock.
// Returns { inputs:[{item,rate}], outputs:[{item,rate}] }.
export function perMachineRates(recipe) {
  const scale = (entry) => ({ item: entry.item, rate: entry.amount * (PER_MINUTE / recipe.time) });
  return {
    inputs: recipe.inputs.map(scale),
    outputs: recipe.outputs.map(scale),
  };
}

// The recipe's primary product (the first output) — what a rate target refers to.
export function primaryOutput(recipe) {
  return recipe.outputs[0];
}

// Core MVP calculation.
//   targetRate = desired units/min of the recipe's primary product.
// Returns a fully-resolved result describing the machines, flows and power.
export function computeRecipePlan(dataset, recipeKey, targetRate) {
  const recipe = dataset.recipes[recipeKey];
  if (!recipe) throw new Error(`unknown recipe: ${recipeKey}`);

  const per = perMachineRates(recipe);
  const primaryPerMachine = per.outputs[0].rate; // primary product first
  const machines = primaryPerMachine > 0 ? targetRate / primaryPerMachine : 0;

  const scaleByMachines = (flow) =>
    flow.map(({ item, rate }) => ({ item, rate: rate * machines }));

  const building = dataset.buildings[recipe.building];
  const outputs = scaleByMachines(per.outputs);

  return {
    recipeKey,
    recipeName: recipe.name,
    building: recipe.building,
    buildingName: building?.name ?? recipe.building,
    targetRate,
    machines,
    power: machines * (building?.power ?? 0),
    inputs: scaleByMachines(per.inputs),
    outputs,                                  // includes the primary product…
    byproducts: outputs.slice(1),             // …and these are the extras
  };
}
