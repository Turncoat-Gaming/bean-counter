// solver.js — full production-chain solver. Pure (no DOM/I/O). Classic script on
// the BeanCounter global; CommonJS-exports for the Node test runner.
//
// Given a target recipe + output rate, it works out the whole chain down to raw
// resources: how much of every intermediate is needed, machines + power per step,
// total raw-resource draw, and byproducts (gross, credited, and surplus).
//
// Approach: each producible item is made by one chosen recipe, so a "production
// level" per item fully describes the plan. We solve those levels by fixed-point
// iteration (Jacobi): each pass recomputes consumption + byproduct supply from
// the current levels, then sets each level to its net demand. This aggregates
// shared intermediates (diamond dependencies) correctly and — crucially — lets a
// byproduct be *credited back* against demand for the same item elsewhere, which
// a one-pass top-down walk cannot do (it couples the whole system: water from the
// aluminium chain feeding its own dilution, HOR looping between plastic/rubber).
//
// Byproduct crediting is opt-in per item via `opts.recycle` (a set of item keys).
// When an item is recycled, its byproduct supply offsets its demand (so fewer
// machines / less raw draw); any leftover is reported as surplus. Without it the
// old behaviour stands: full gross production, byproducts reported but uncredited.
//
// `opts.provided` (a set of item keys) marks items supplied externally: the chain
// stops there and they surface as `lineInputs` (this line's required inputs)
// instead of expanding to raw. This is the seam for composing lines — one line's
// output feeding another's input. Provided items are credited like raw resources.
//
// Known simplifications (documented, not bugs):
//   - Each item is produced by a single chosen recipe (standard by default; an
//     override map can pick alternates). Recipe cycles are detected, truncated,
//     and surfaced as a warning rather than looping forever.
//   - The production tree is a literal gross-flow view; the Totals reflect any
//     crediting, so a recycled chain's tree shows more than its totals.
(function (BC) {
  'use strict';

  function solveChain(dataset, targetItem, targetRate, opts) {
    opts = opts || {};

    // Per-item recipe choice: explicit override > raw-resource leaf > default.
    // The target's root recipe is just its entry in `choices`: an explicit
    // override (an alternate, or a byproduct source) or its default producer.
    // outputFor() below scales by whichever output slot makes the target, so a
    // byproduct target works the same as a primary one.
    const choices = Object.assign({}, opts.recipeChoices || {});
    const targetRecipeKey = choices[targetItem] || BC.data.defaultRecipeForItem(dataset, targetItem);
    if (!targetRecipeKey) throw new Error('no recipe makes item: ' + targetItem);
    choices[targetItem] = targetRecipeKey;
    const recycle = new Set(opts.recycle || []); // items whose byproducts are credited
    const provided = new Set(opts.provided || []); // items supplied externally (line inputs)
    const warnings = [];

    function label(item) { return (dataset.items[item] && dataset.items[item].name) || item; }
    function recipeFor(item) {
      if (choices[item]) return choices[item];
      if (dataset.items[item] && dataset.items[item].resource) return null;
      return BC.data.defaultRecipeKey(dataset, item);
    }
    // What recipe (if any) to expand for this item. Provided items are leaves:
    // supplied by another line, so we stop and surface them as line inputs rather
    // than building their sub-chain here. recipeFor still knows the "real" recipe,
    // which lets us tell a providable intermediate apart from a true raw leaf.
    function expandRecipe(item) {
      if (provided.has(item)) return null;
      return recipeFor(item);
    }
    function outputFor(recipe, item) {
      return recipe.outputs.find((o) => o.item === item) || recipe.outputs[0];
    }

    // depthToRaw(item): longest path to a raw leaf — used to order steps (target first).
    const depthMemo = new Map();
    function depthToRaw(item, stack) {
      if (depthMemo.has(item)) return depthMemo.get(item);
      const rk = expandRecipe(item);
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
      const rk = expandRecipe(item);
      if (!rk) { if (!provided.has(item)) node.raw = true; return node; } // provided leaves tagged below
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
    tree.isTarget = true; // the root node picks from all recipes that output the target

    // Every item we actively produce (target + producible descendants).
    const produced = new Set();
    (function collect(item, stack) {
      const rk = expandRecipe(item);
      if (!rk) return;                                 // raw / provided leaf — not produced
      if (stack.has(item)) {
        warnings.push('Recipe cycle involving ' + label(item) + '; chain truncated there.');
        return;
      }
      if (produced.has(item)) return;                  // shared intermediate, already walked
      produced.add(item);
      const recipe = dataset.recipes[rk];
      const next = new Set(stack); next.add(item);
      for (const inp of recipe.inputs) collect(inp.item, next);
    })(targetItem, new Set());

    // Cache each producer's recipe + per-machine throughput.
    const info = new Map();
    for (const item of produced) {
      const recipe = dataset.recipes[recipeFor(item)];
      const out = outputFor(recipe, item);
      info.set(item, { recipe, out, perMachine: out.amount * (60 / recipe.time), b: dataset.buildings[recipe.building] });
    }

    // Flows (consumption + byproduct supply) implied by the current production levels.
    function flows(prod) {
      const consume = Object.create(null), bsupply = Object.create(null);
      for (const item of produced) {
        const { recipe, out } = info.get(item);
        const runs = prod[item] / out.amount;
        for (const inp of recipe.inputs) consume[inp.item] = (consume[inp.item] || 0) + runs * inp.amount;
        for (const o of recipe.outputs) {
          if (o.item === item) continue;
          bsupply[o.item] = (bsupply[o.item] || 0) + runs * o.amount;
        }
      }
      return { consume, bsupply };
    }

    // Fixed-point (Jacobi) solve for production levels. Each pass: net demand =
    // (external target + consumption) − credited byproduct, floored at zero.
    // Converges in ~one pass per chain level; the cap is a safety net only.
    const prod = Object.create(null);
    for (const item of produced) prod[item] = 0;
    let consume = Object.create(null), bsupply = Object.create(null);
    for (let iter = 0; ; iter++) {
      ({ consume, bsupply } = flows(prod));
      let maxDiff = 0;
      for (const item of produced) {
        const demand = (item === targetItem ? targetRate : 0) + (consume[item] || 0);
        const credit = recycle.has(item) ? Math.min(bsupply[item] || 0, demand) : 0;
        const next = Math.max(0, demand - credit);
        maxDiff = Math.max(maxDiff, Math.abs(next - prod[item]));
        prod[item] = next;
      }
      if (maxDiff < 1e-9) break;
      if (iter >= 1000) { warnings.push('Byproduct crediting did not fully converge; totals are approximate.'); break; }
    }
    ({ consume, bsupply } = flows(prod)); // final flows from the converged levels

    const demandOf = (item) => (item === targetItem ? targetRate : 0) + (consume[item] || 0);

    // Tag tree nodes with the state their per-node toggles need: ♻ recycle and
    // 📦 supply-externally both live on tree nodes. recyclable = a byproduct source
    // exists; canProvide = a real intermediate (not the target, not a raw leaf), so
    // it's eligible to be sourced from another line.
    (function annotate(node) {
      node.recyclable = (bsupply[node.item] || 0) > 1e-9;
      node.recycling = recycle.has(node.item);
      node.provided = provided.has(node.item);
      node.canProvide = node.item !== targetItem && recipeFor(node.item) !== null;
      (node.children || []).forEach(annotate);
    })(tree);

    // Production steps.
    const steps = [];
    const byBuilding = Object.create(null);
    let totalPower = 0, totalMachines = 0;
    for (const item of produced) {
      const { perMachine, b, recipe } = info.get(item);
      const rate = prod[item];
      const machines = perMachine > 0 ? rate / perMachine : 0;
      const recyclable = (bsupply[item] || 0) > 1e-9;     // a byproduct source for this item exists
      if (machines <= 1e-9 && !recyclable) continue;       // nothing to build, nothing to toggle
      const power = machines * (b ? b.power : 0);
      totalPower += power;
      totalMachines += machines;
      byBuilding[recipe.building] = (byBuilding[recipe.building] || 0) + machines;
      steps.push({
        item, recipeKey: recipeFor(item), recipeName: recipe.name, alternate: !!recipe.alternate,
        rate, machines, building: recipe.building, buildingName: b ? b.name : recipe.building,
        power, depth: depthToRaw(item, new Set()),
        recyclable, recycling: recycle.has(item),
      });
    }

    // Consumed leaves, net of any credited byproduct. Provided items are the
    // line's external inputs (sourced from another line); everything else is a
    // mined/extracted raw resource.
    const raw = [];
    const lineInputs = [];
    for (const item of Object.keys(consume)) {
      if (produced.has(item)) continue;
      const supply = bsupply[item] || 0;
      const credit = recycle.has(item) ? Math.min(supply, consume[item]) : 0;
      const draw = Math.max(0, consume[item] - credit);
      const recyclable = supply > 1e-9;
      if (draw <= 1e-9 && !recyclable) continue;
      const row = { item, rate: draw, recyclable, recycling: recycle.has(item) };
      (provided.has(item) ? lineInputs : raw).push(row);
    }

    // Byproducts: gross output, how much was credited back, and the leftover surplus.
    const byproducts = [];
    for (const item of Object.keys(bsupply)) {
      const gross = bsupply[item];
      if (gross <= 1e-9) continue;
      const demand = demandOf(item);
      const credited = recycle.has(item) ? Math.min(gross, demand) : 0;
      const it = dataset.items[item];
      byproducts.push({
        item, gross, credited, surplus: gross - credited,
        form: it ? it.form : 'solid',
        fluid: it ? (it.form === 'liquid' || it.form === 'gas') : false,
        recyclable: demand > 1e-9,        // could be reused (it's consumed somewhere)
        recycling: recycle.has(item),
      });
    }

    const byName = (a, b) => label(a.item).localeCompare(label(b.item));
    steps.sort((a, b) => b.depth - a.depth || a.recipeName.localeCompare(b.recipeName)); // target first
    raw.sort(byName);
    lineInputs.sort(byName);
    byproducts.sort(byName);

    return {
      targetItem, targetRecipeKey, targetRate,
      tree,
      steps, raw, lineInputs, byproducts,
      totals: { power: totalPower, machines: totalMachines, byBuilding },
      warnings: [...new Set(warnings)],
    };
  }

  // rollUpFactory — aggregate several independently-solved lines into one factory
  // view. Pure. Each line is normalized (by the caller) to:
  //   { target, supplies:[{item,rate}], demands:[{item,rate}], raw:[{item,rate}],
  //     power, machines, byBuilding }
  // where `supplies` are what the line offers (its target output + any byproduct
  // surplus), `demands` are its external inputs (the 📦 line inputs), and `raw` is
  // its mined draw. `target` is the line's product item (so net-positive supply of
  // it is flagged a factory product rather than a stray byproduct).
  //
  // Lines still solve independently; this only *nets* supply against demand by item
  // key and reports who feeds whom. An item's demand is satisfied internally when
  // some other line supplies it; greedy allocation (producers in line order) turns
  // that into concrete line→line routes — the view that drives physical layout.
  // Many producers/consumers of one item resolve to several routes, which is the
  // cue to split a line.
  function rollUpFactory(dataset, lines) {
    function label(item) { return (dataset.items[item] && dataset.items[item].name) || item; }
    const byName = (a, b) => label(a.item).localeCompare(label(b.item));

    let power = 0, machines = 0;
    const byBuilding = Object.create(null);
    const rawAgg = Object.create(null);
    const producers = Object.create(null); // item -> [{line, rate}] in line order
    const consumers = Object.create(null); // item -> [{line, rate}] in line order
    const targets = new Set();              // items that are some line's product

    lines.forEach((ln, i) => {
      power += ln.power || 0;
      machines += ln.machines || 0;
      for (const b of Object.keys(ln.byBuilding || {})) byBuilding[b] = (byBuilding[b] || 0) + ln.byBuilding[b];
      for (const r of ln.raw || []) rawAgg[r.item] = (rawAgg[r.item] || 0) + r.rate;
      if (ln.target) targets.add(ln.target);
      for (const s of ln.supplies || []) {
        if (s.rate <= 1e-9) continue;
        (producers[s.item] = producers[s.item] || []).push({ line: i, rate: s.rate });
      }
      for (const d of ln.demands || []) {
        if (d.rate <= 1e-9) continue;
        (consumers[d.item] = consumers[d.item] || []).push({ line: i, rate: d.rate });
      }
    });

    const routes = [];     // {item, from, to, rate}; merged by (item,from,to) below
    const outputs = [];    // net supply > 0
    const unmet = [];      // net demand > 0 (still sourced externally)
    const items = new Set([...Object.keys(producers), ...Object.keys(consumers)]);
    for (const item of items) {
      const prod = producers[item] || [];
      const cons = consumers[item] || [];
      const totalProd = prod.reduce((s, p) => s + p.rate, 0);
      const totalCons = cons.reduce((s, c) => s + c.rate, 0);

      // Greedy allocate supply to demand, both in line order, to build routes.
      const pr = prod.map((p) => ({ line: p.line, rem: p.rate }));
      let pi = 0;
      for (const c of cons) {
        let need = c.rate;
        while (need > 1e-9 && pi < pr.length) {
          const give = Math.min(need, pr[pi].rem);
          if (give > 1e-9 && pr[pi].line !== c.line) routes.push({ item, from: pr[pi].line, to: c.line, rate: give });
          pr[pi].rem -= give;
          need -= give;
          if (pr[pi].rem <= 1e-9) pi++;
        }
      }

      const net = totalProd - totalCons;
      if (net > 1e-9) outputs.push({ item, rate: net, product: targets.has(item) });
      else if (net < -1e-9) unmet.push({ item, rate: -net });
    }

    // Merge routes that share (item, from, to) so each feed shows as one edge.
    const merged = [];
    const seen = new Map();
    for (const r of routes) {
      const k = r.item + ' ' + r.from + ' ' + r.to;
      if (seen.has(k)) seen.get(k).rate += r.rate;
      else { const c = { item: r.item, from: r.from, to: r.to, rate: r.rate }; seen.set(k, c); merged.push(c); }
    }

    const raw = Object.keys(rawAgg).map((item) => ({ item, rate: rawAgg[item] })).sort(byName);
    outputs.sort(byName);
    unmet.sort(byName);
    merged.sort((a, b) => byName(a, b) || a.from - b.from || a.to - b.to);

    return { power, machines, byBuilding, raw, routes: merged, outputs, unmet };
  }

  BC.solver = { solveChain, rollUpFactory };
  if (typeof module === 'object' && module.exports) module.exports = BC.solver;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
