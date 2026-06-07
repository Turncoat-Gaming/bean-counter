// solver.js — full production-chain solver. Pure (no DOM/I/O). Classic script on
// the BeanCounter global; CommonJS-exports for the Node test runner.
//
// Given a target recipe + output rate, it works out the whole chain down to raw
// resources: how much of every intermediate is needed, machines + power per step,
// total raw-resource draw, and gross byproducts.
//
// Approach: compute, per item, the per-unit demand of every descendant
// (memoized), then multiply by the target rate. Memoization makes shared
// intermediates (diamond dependencies like Iron Ingot feeding both plates and
// screws) aggregate correctly without re-walking subtrees.
//
// Known simplifications (documented, not bugs):
//   - Byproducts are reported gross; they are NOT credited back against demand
//     for the same item elsewhere (that needs a linear solve).
//   - Each item is produced by a single chosen recipe (standard by default; an
//     override map can pick alternates). Recipe cycles are detected, truncated,
//     and surfaced as a warning rather than looping forever.
(function (BC) {
  'use strict';

  function solveChain(dataset, targetRecipeKey, targetRate, opts) {
    opts = opts || {};
    const targetRecipe = dataset.recipes[targetRecipeKey];
    if (!targetRecipe) throw new Error('unknown recipe: ' + targetRecipeKey);
    const targetItem = targetRecipe.outputs[0].item;

    // Per-item recipe choice: explicit override > raw-resource leaf > default.
    const choices = Object.assign({}, opts.recipeChoices || {});
    choices[targetItem] = targetRecipeKey;
    const warnings = [];

    function label(item) { return (dataset.items[item] && dataset.items[item].name) || item; }
    function recipeFor(item) {
      if (choices[item]) return choices[item];
      if (dataset.items[item] && dataset.items[item].resource) return null;
      return BC.data.defaultRecipeKey(dataset, item);
    }
    function outputFor(recipe, item) {
      return recipe.outputs.find((o) => o.item === item) || recipe.outputs[0];
    }

    // unit(item): map of { descendantItem: rate per 1 unit/min of item }, incl. itself.
    const unitMemo = new Map();
    function unit(item, stack) {
      if (unitMemo.has(item)) return unitMemo.get(item);
      const m = Object.create(null);
      m[item] = 1;
      const rk = recipeFor(item);
      if (rk && stack.has(item)) {
        warnings.push('Recipe cycle involving ' + label(item) + '; chain truncated there.');
      } else if (rk) {
        const recipe = dataset.recipes[rk];
        const out = outputFor(recipe, item);
        const next = new Set(stack); next.add(item);
        for (const inp of recipe.inputs) {
          const perUnit = inp.amount / out.amount;
          const child = unit(inp.item, next);
          for (const k in child) m[k] = (m[k] || 0) + child[k] * perUnit;
        }
      }
      unitMemo.set(item, m);
      return m;
    }

    // depthToRaw(item): longest path to a raw leaf — used to order steps (target first).
    const depthMemo = new Map();
    function depthToRaw(item, stack) {
      if (depthMemo.has(item)) return depthMemo.get(item);
      const rk = recipeFor(item);
      if (!rk || stack.has(item)) { depthMemo.set(item, 0); return 0; }
      const recipe = dataset.recipes[rk];
      const next = new Set(stack); next.add(item);
      let d = 0;
      for (const inp of recipe.inputs) d = Math.max(d, 1 + depthToRaw(inp.item, next));
      depthMemo.set(item, d);
      return d;
    }

    // A literal production tree (duplicates shared intermediates so you can see
    // where each branch's demand goes). Totals come from the aggregated solve
    // below and stay exact even if the tree is truncated for size.
    let nodeBudget = 0;
    let treeTruncated = false;
    function buildTree(item, rate, path) {
      const node = { item, rate };
      if (nodeBudget++ > 4000) {
        node.truncated = true;
        if (!treeTruncated) { treeTruncated = true; warnings.push('Production tree is very large; display truncated (totals are still exact).'); }
        return node;
      }
      const rk = recipeFor(item);
      if (!rk) { node.raw = true; return node; }
      if (path.has(item)) { node.cycle = true; return node; }
      const recipe = dataset.recipes[rk];
      const out = outputFor(recipe, item);
      const perMachine = out.amount * (60 / recipe.time);
      const b = dataset.buildings[recipe.building];
      node.recipeKey = rk;
      node.recipeName = recipe.name;
      node.alternate = !!recipe.alternate;
      node.building = recipe.building;
      node.buildingName = b ? b.name : recipe.building;
      node.machines = perMachine > 0 ? rate / perMachine : 0;
      node.power = node.machines * (b ? b.power : 0);
      const crafts = rate / out.amount;
      const next = new Set(path); next.add(item);
      node.children = recipe.inputs.map((inp) => buildTree(inp.item, crafts * inp.amount, next));
      return node;
    }
    const tree = buildTree(targetItem, targetRate, new Set());

    const perUnit = unit(targetItem, new Set());
    const demand = Object.create(null);
    for (const k in perUnit) demand[k] = perUnit[k] * targetRate;

    const steps = [];
    const raw = [];
    const byproducts = Object.create(null);
    const byBuilding = Object.create(null);
    let totalPower = 0, totalMachines = 0;

    for (const item of Object.keys(demand)) {
      const rate = demand[item];
      const rk = recipeFor(item);
      if (!rk) { raw.push({ item, rate }); continue; }
      const recipe = dataset.recipes[rk];
      const out = outputFor(recipe, item);
      const perMachine = out.amount * (60 / recipe.time);
      const machines = perMachine > 0 ? rate / perMachine : 0;
      const b = dataset.buildings[recipe.building];
      const power = machines * (b ? b.power : 0);
      totalPower += power;
      totalMachines += machines;
      byBuilding[recipe.building] = (byBuilding[recipe.building] || 0) + machines;
      steps.push({
        item, recipeKey: rk, recipeName: recipe.name, alternate: !!recipe.alternate,
        rate, machines, building: recipe.building, buildingName: b ? b.name : recipe.building,
        power, depth: depthToRaw(item, new Set()),
      });
      for (const o of recipe.outputs) {
        if (o.item === item) continue;
        byproducts[o.item] = (byproducts[o.item] || 0) + o.amount * (60 / recipe.time) * machines;
      }
    }

    const byName = (a, b) => label(a.item).localeCompare(label(b.item));
    steps.sort((a, b) => b.depth - a.depth || a.recipeName.localeCompare(b.recipeName)); // target first
    raw.sort(byName);
    const byproductList = Object.keys(byproducts).map((item) => ({ item, rate: byproducts[item] })).sort(byName);

    return {
      targetItem, targetRecipeKey, targetRate,
      tree,
      steps, raw, byproducts: byproductList,
      totals: { power: totalPower, machines: totalMachines, byBuilding },
      warnings,
    };
  }

  BC.solver = { solveChain };
  if (typeof module === 'object' && module.exports) module.exports = BC.solver;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
