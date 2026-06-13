// rate-calculator.js — the planner view. Owns DOM only; all math lives in the
// engine. A doc holds one or more *lines* (one factory), shown as a stacked
// accordion. Each line is the old single-plan planner: a target *item* (any
// manufacturable product or byproduct) + rate, with per-item recipe choices made
// on the production tree, ♻ recycle and 📦 supply-externally toggles, in "Full
// chain" or "Single step" mode. The main dropdown picks the item to make; the
// tree's root node picks which recipe makes it (alternates and byproduct sources).
//
// A line can instead be driven "From a supply": pick a source item + how much you
// have, and the line lists what's reachable from it; choosing an end product sizes
// the output to whatever that supply yields (the binding constraint), then solves
// the rest backward. The root recipe's options show each path's yield so you can
// pick the one that stretches the supply furthest.
//
// A factory summary nets the lines together and shows which line feeds which.
// Classic script: exposes BeanCounter.ui.mountPlanner (loads over file://).
(function (BC) {
  'use strict';

  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // Escape any value before it goes into innerHTML. Recipe/item names come from
  // the trusted dataset today, but this keeps us safe if user-imported data or
  // bookmark-provided text is ever rendered.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Drop the "Alternate: " prefix for display — the "alt" tag carries that info.
  const variantLabel = (name) => name.replace(/^Alternate:\s*/, '');

  function mountPlanner(root, dataset) {
    const data = BC.data;
    const { computeRecipePlan } = BC.calculator;
    const { solveChain, sizeFromSupplies, rollUpFactory } = BC.solver;
    const { encodePlan, decodePlan } = BC.codec;
    const itemName = (i) => data.itemName(dataset, i);
    const isFluid = (i) => { const it = dataset.items[i]; return !!it && (it.form === 'liquid' || it.form === 'gas'); };

    // Advanced Game Settings global multipliers (recipe parts cost, machine power).
    // They rescale the math but not the structure, so we keep the static pickers on
    // `dataset` and solve against this derived one. `solveDataset` is rebuilt only
    // when a multiplier changes; at 1×/1× it *is* `dataset`. Persisted in the bookmark.
    const COST_MULTS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const POWER_MULTS = [0.25, 0.5, 0.75, 1, 2, 5];
    let mods = { costMult: 1, powerMult: 1 };
    let solveDataset = dataset;
    const applyMods = () => { solveDataset = data.applyModifiers(dataset, mods); };
    const costSel = document.querySelector('#cost-mult');
    const powerSel = document.querySelector('#power-mult');
    function fillMultSelect(sel, values, current) {
      if (!sel) return;
      sel.innerHTML = values.map((v) =>
        '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>×' + v + '</option>').join('');
    }
    function syncMultSelects() {
      if (costSel) costSel.value = mods.costMult;
      if (powerSel) powerSel.value = mods.powerMult;
    }
    function onModChange() {
      mods = {
        costMult: Number(costSel && costSel.value) || 1,
        powerMult: Number(powerSel && powerSel.value) || 1,
      };
      applyMods();
      rebuild();
    }

    // The item picker is the same for every line — precompute its <option>s. The
    // list is every manufacturable item (products and byproducts); which recipe
    // makes the chosen item is picked later on the tree's root node.
    const itemList = data.manufacturableItems(dataset).map((item) => ({ item, label: itemName(item) }));
    const firstItem = itemList[0] && itemList[0].item;
    const itemOptions = (activeItem) =>
      itemList.map(({ item, label }) =>
        '<option value="' + esc(item) + '"' + (item === activeItem ? ' selected' : '') + '>' + esc(label) + '</option>'
      ).join('');

    // The supply picker lists every item something consumes (incl. raws), since any
    // of those can be a starting supply. The first input item is a sane default.
    const sourceList = data.inputItems(dataset).map((item) => ({ item, label: itemName(item) }));
    const firstSource = sourceList[0] && sourceList[0].item;
    const optionList = (list, active) =>
      list.map(({ item, label }) =>
        '<option value="' + esc(item) + '"' + (item === active ? ' selected' : '') + '>' + esc(label) + '</option>'
      ).join('');
    const sourceOptions = (active) => optionList(sourceList, active);
    // The "Make" list is per-line: what's reachable from that line's supply.
    const makeOptions = (line) =>
      optionList(data.reachableFrom(dataset, line.sourceItem).map((item) => ({ item, label: itemName(item) })), line.targetItem);

    // How much of a supply line's source the end product draws when made via
    // `rootKey`, treating the supply as the chain boundary (so a source with its own
    // recipe isn't expanded away). 0 means that path doesn't consume the supply.
    function sourceDraw(line, rootKey) {
      const provided = [...new Set([...line.provided, line.sourceItem])];
      const u = solveChain(solveDataset, line.targetItem, 1, {
        recipeChoices: Object.assign({}, line.choices, { [line.targetItem]: rootKey }),
        recycle: [...line.recycle], provided,
      });
      const row = u.raw.find((r) => r.item === line.sourceItem) || u.lineInputs.find((r) => r.item === line.sourceItem);
      return row ? row.rate : 0;
    }

    // Land a supply line on a root recipe that actually consumes the supply (standard
    // first) so the default view is useful — rather than the item's default recipe,
    // which may bypass the supply entirely (e.g. Fuel from Crude Oil ignores HOR).
    // An explicit pick that's already bound is kept; if nothing consumes it, leave it
    // so the UI shows "this path doesn't use …".
    function ensureBoundPath(line) {
      const cur = line.choices[line.targetItem] || data.defaultRecipeForItem(dataset, line.targetItem);
      if (cur && sourceDraw(line, cur) > 1e-9) return;
      const bound = data.recipesOutputting(dataset, line.targetItem).find((k) => sourceDraw(line, k) > 1e-9);
      if (bound) line.choices[line.targetItem] = bound;
    }

    // Keep a supply line's end product valid for its source: if the current target
    // isn't reachable from the source, fall back to the first reachable item; then
    // land on a recipe path that consumes the supply.
    function reconcileSupplyTarget(line) {
      const reach = data.reachableFrom(dataset, line.sourceItem);
      if (reach.length && !reach.includes(line.targetItem)) {
        line.targetItem = reach[0];
        delete line.choices[line.targetItem];
      }
      ensureBoundPath(line);
    }

    root.innerHTML =
      '<section id="lines"></section>' +
      '<div class="add-row"><button id="add-line" type="button">+ Add line</button></div>' +
      '<section id="factory" class="panel result" aria-live="polite" hidden></section>' +
      '<section class="panel bookmark">' +
      '  <label for="bookmark">Bookmark (paste to restore a plan)</label>' +
      '  <div class="row"><input id="bookmark" type="text" spellcheck="false" />' +
      '    <button id="copy" type="button">Copy</button></div>' +
      '</section>';

    const linesEl = root.querySelector('#lines');
    const factoryEl = root.querySelector('#factory');
    const bookmarkEl = root.querySelector('#bookmark');

    // A line ≈ the old single-plan state. Per-line so duplicate lines never share.
    let lines = [];
    function newLine() {
      return {
        targetItem: firstItem,  // the item to make; its recipe lives in `choices`
        targetRate: 60, mode: 'chain',
        driver: 'rate',                            // 'rate' (target output) | 'supply' (size from a supply)
        sourceItem: firstSource, supplyRate: 60,   // supply-driven inputs (the supply, and how much)
        choices: {}, recycle: new Set(), provided: new Set(),
        collapsed: new Set(),  // tree nodes collapsed (by path)
        expanded: true,        // accordion open
        summary: null,         // normalized {target,supplies,demands,raw,...} for the roll-up
        bmChoiceKeys: [], bmRecycle: [], bmProvided: [], // in-play overrides for the bookmark
      };
    }

    // ---- shared HTML helpers (operate on a node/step, no globals) -----------

    const flowList = (list, getRate, getItem) =>
      list.map((x) => '<li><span>' + fmt(getRate(x)) + '/min</span> ' + esc(itemName(getItem(x))) + '</li>').join('');

    // Recipe <select> for a step where there's a choice; empty otherwise. The
    // target (root) node may be made from any recipe that outputs the item — incl.
    // recipes where it's a byproduct; deeper nodes use their primary-product recipes.
    // `pathYields` (supply-driven lines only) maps each root recipe to the output it
    // would yield from the supply, shown inline so you can pick the best path.
    function recipeCell(step, pathYields) {
      const variants = step.isTarget
        ? data.recipesOutputting(dataset, step.item)
        : data.recipesForItem(dataset, step.item);
      if (variants.length <= 1) return '';
      const opts = variants.map((k) => {
        const r = dataset.recipes[k];
        let lbl = variantLabel(r.name) + (r.alternate ? ' (alt)' : '');
        if (step.isTarget && pathYields) {
          const y = pathYields[k];
          lbl += ' — ' + (y == null ? 'n/a' : fmt(y) + '/min');
        }
        return '<option value="' + esc(k) + '"' + (k === step.recipeKey ? ' selected' : '') + '>' + esc(lbl) + '</option>';
      }).join('');
      return '<select class="step-recipe" data-item="' + esc(step.item) +
        '" aria-label="Recipe for ' + esc(itemName(step.item)) + '">' + opts + '</select>';
    }

    function recipeName(step) {
      const tag = step.alternate ? '<span class="tag">alt</span>' : '';
      return tag + esc(variantLabel(step.recipeName));
    }

    // "♻ reuse" on a node whose item has a byproduct source to pull from.
    function recycleToggle(x) {
      if (!x.recyclable) return '';
      return '<label class="recycle" title="Reuse this item\'s byproduct supply">' +
        '<input type="checkbox" class="recycle-toggle" data-item="' + esc(x.item) + '"' +
        (x.recycling ? ' checked' : '') + '> ♻</label>';
    }

    // "📦 supply externally" on a real intermediate: stop the chain, treat as a
    // line input (sourced from another line).
    function provideToggle(x) {
      if (!x.canProvide) return '';
      return '<label class="provide" title="Source this item from another line">' +
        '<input type="checkbox" class="provide-toggle" data-item="' + esc(x.item) + '"' +
        (x.provided ? ' checked' : '') + '> 📦</label>';
    }

    // One node of the production tree (nested <ul> gives the indentation). `path`
    // is the route from the root so collapse state maps to the right occurrence.
    function treeNode(node, path, collapsedSet, pathYields) {
      const hasKids = node.children && node.children.length;
      const toggle = hasKids
        ? '<button type="button" class="tree-toggle" data-path="' + esc(path) + '" aria-label="Collapse or expand"></button>'
        : '<span class="tree-toggle empty"></span>';

      const name = '<span class="item">' + esc(itemName(node.item)) + '</span> ' +
        '<span class="rate">' + fmt(node.rate) + '/min</span> ';
      let body;
      if (node.provided) {                  // sourced from another line — a leaf
        body = toggle + '<span class="input-tag">input</span> ' + name +
          recycleToggle(node) + provideToggle(node);
      } else if (node.raw) {                 // mined/extracted — a leaf
        body = toggle + '<span class="raw-tag">raw</span> ' + name + recycleToggle(node);
      } else if (node.cycle) {               // recipe loop — truncated leaf (no machines)
        body = toggle + '<span class="raw-tag warn">cycle</span> ' + name;
      } else if (node.truncated) {           // tree too large — display cut here
        body = toggle + '<span class="raw-tag">…</span> ' + name;
      } else {                               // built here
        body = toggle +
          '<span class="mach">' + fmt(node.machines) + '×</span> ' +
          '<span class="bld">' + esc(node.buildingName) + '</span> ' +
          name + recipeCell(node, node.isTarget ? pathYields : null) + recycleToggle(node) + provideToggle(node);
      }

      const collapsed = hasKids && collapsedSet.has(path);
      let html = '<li class="' + (collapsed ? 'collapsed' : '') + '"><div class="node">' + body + '</div>';
      if (hasKids) {
        html += '<ul>' + node.children.map((c) => treeNode(c, path + '>' + c.item, collapsedSet, pathYields)).join('') + '</ul>';
      }
      return html + '</li>';
    }

    // ---- per-line rendering -------------------------------------------------

    // Full chain: solve, render into the line's .result, stash its roll-up
    // summary + bookmark scratch, and return the solution (for head stats).
    function renderChain(line, resultEl) {
      const opts = { recipeChoices: line.choices, recycle: [...line.recycle], provided: [...line.provided] };
      let sol, pathYields = null;
      if (line.driver === 'supply') {
        // Size the output from the supply, and re-derive the (display) target rate.
        sol = sizeFromSupplies(solveDataset, line.targetItem, [{ item: line.sourceItem, rate: line.supplyRate }], opts);
        line.targetRate = sol.sizing.targetRate;
        // Per-path yield hints for the root recipe selector: how much each recipe
        // that outputs the end product would make from this supply.
        pathYields = {};
        for (const k of data.recipesOutputting(dataset, line.targetItem)) {
          const draw = sourceDraw(line, k);
          pathYields[k] = draw > 1e-9 ? line.supplyRate / draw : null;
        }
      } else {
        sol = solveChain(solveDataset, line.targetItem, line.targetRate, opts);
      }
      const targetItem = sol.targetItem;

      // Which overrides are actually in play (for a tidy bookmark).
      const stepItems = new Set(sol.steps.map((s) => s.item));
      line.bmChoiceKeys = Object.keys(line.choices)
        .filter((it) => stepItems.has(it) && it !== targetItem)
        .map((it) => line.choices[it]);
      const recyclableNow = new Set();
      sol.steps.forEach((s) => { if (s.recyclable) recyclableNow.add(s.item); });
      sol.raw.forEach((r) => { if (r.recyclable) recyclableNow.add(r.item); });
      line.bmRecycle = [...line.recycle].filter((it) => recyclableNow.has(it));
      const providedNow = new Set(sol.lineInputs.map((i) => i.item));
      line.bmProvided = [...line.provided].filter((it) => providedNow.has(it));

      // Normalized summary for the factory roll-up: this line offers its target
      // output + any byproduct surplus, and needs its 📦 line inputs.
      line.summary = {
        target: targetItem,
        supplies: [{ item: targetItem, rate: sol.targetRate }].concat(
          sol.byproducts.filter((b) => b.surplus > 1e-9).map((b) => ({ item: b.item, rate: b.surplus }))),
        demands: sol.lineInputs.map((i) => ({ item: i.item, rate: i.rate })),
        raw: sol.raw.map((r) => ({ item: r.item, rate: r.rate })),
        power: sol.totals.power, machines: sol.totals.machines, byBuilding: sol.totals.byBuilding,
      };

      const buildings = Object.keys(sol.totals.byBuilding)
        .map((k) => [k, sol.totals.byBuilding[k]])
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => fmt(m) + '× ' + esc(data.buildingName(dataset, k)))
        .join(' · ');

      const tree = '<ul class="tree">' + treeNode(sol.tree, sol.tree.item, line.collapsed, pathYields) + '</ul>';

      const rows = sol.steps.map((s) =>
        '<tr>' +
        '<td class="mach">' + fmt(s.machines) + '×</td>' +
        '<td class="bld">' + esc(s.buildingName) + '</td>' +
        '<td class="item">' + esc(itemName(s.item)) + '</td>' +
        '<td class="rate">' + fmt(s.rate) + '/min</td>' +
        '<td class="rec">' + recipeName(s) + '</td>' +
        '</tr>'
      ).join('');

      const totalsTable =
        '<div class="steps-wrap"><table class="steps"><thead><tr>' +
        '<th class="mach">Qty</th><th>Building</th><th>Item</th><th class="rate">Rate</th><th>Recipe</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';

      const rawList = sol.raw.map((r) =>
        '<li><span>' + fmt(r.rate) + '/min</span> ' + esc(itemName(r.item)) + '</li>'
      ).join('') || '<li class="muted">none</li>';

      const lineInputsSection = sol.lineInputs.length
        ? '<h3>Required inputs</h3>' +
          '<p class="muted tree-note">Sourced from another line. Provide these to feed this one.</p>' +
          '<ul class="cols-list">' + sol.lineInputs.map((i) =>
            '<li><span>' + fmt(i.rate) + '/min</span> ' + esc(itemName(i.item)) + '</li>'
          ).join('') + '</ul>'
        : '';

      const byproductList = sol.byproducts.map((b) => {
        const reused = b.credited > 0 ? ' <span class="muted">(' + fmt(b.credited) + '/min reused)</span>' : '';
        if (b.surplus <= 0) {
          return '<li><span>0/min</span> surplus ' + esc(itemName(b.item)) + reused + '</li>';
        }
        const cls = 'surplus' + (b.fluid ? ' fluid' : '');
        const hint = b.fluid
          ? '<span class="hint">fluid surplus — needs a recycle loop or conversion to a sinkable product</span>'
          : (b.recyclable && !b.recycling ? '<span class="hint">tick ♻ on its node in the tree to reuse it</span>' : '');
        return '<li><span class="' + cls + '">' + fmt(b.surplus) + '/min</span> surplus ' +
          esc(itemName(b.item)) + reused + (hint ? ' ' + hint : '') + '</li>';
      }).join('') || '<li class="muted">none</li>';

      resultEl.innerHTML =
        '<div class="buildings muted">' + buildings + '</div>' +
        '<h3>Production tree</h3>' +
        '<p class="muted tree-note">On any node: pick a recipe (applies to that item across the plan), tick ♻ to reuse its byproduct, or 📦 to source it from another line (stops the chain there). The tree shows gross flow; Totals below reflect recycling and external inputs.</p>' +
        tree +
        '<h3>Totals</h3>' +
        totalsTable +
        lineInputsSection +
        '<div class="cols">' +
        '<div><h3>Raw resources</h3><ul>' + rawList + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul class="byproducts">' + byproductList + '</ul></div>' +
        '</div>' +
        (sol.warnings.length ? '<p class="error">' + sol.warnings.map(esc).join('<br>') + '</p>' : '');

      return sol;
    }

    // Single step: just the recipe chosen to make the target item.
    function renderSingle(line, resultEl) {
      const rootKey = line.choices[line.targetItem] || data.defaultRecipeForItem(dataset, line.targetItem);
      const recipe = dataset.recipes[rootKey];
      const target = line.targetItem;
      const plan = computeRecipePlan(solveDataset, rootKey, line.targetRate, target);
      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(plan.machines) + '</strong> × ' + esc(plan.buildingName) +
        '<span class="power">' + fmt(plan.power) + ' MW</span></div>' +
        '<div class="cols">' +
        '<div><h3>Inputs</h3><ul>' + (flowList(plan.inputs, (f) => f.rate, (f) => f.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul>' + (flowList(plan.byproducts, (f) => f.rate, (f) => f.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '</div>';
      // A single-step line still participates in the factory: it offers its
      // output + byproducts and needs all its recipe inputs externally.
      line.summary = {
        target,
        supplies: [{ item: target, rate: line.targetRate }].concat(plan.byproducts.map((b) => ({ item: b.item, rate: b.rate }))),
        demands: plan.inputs.map((i) => ({ item: i.item, rate: i.rate })),
        raw: [],
        power: plan.power, machines: plan.machines, byBuilding: { [recipe.building]: plan.machines },
      };
      line.bmChoiceKeys = []; line.bmRecycle = []; line.bmProvided = [];
      return { machines: plan.machines, power: plan.power, target };
    }

    function renderLineResult(line, panel) {
      const resultEl = panel.querySelector('.result');
      let machines, power, targetKey;
      // Supply-driven lines are always a full chain (there's a chain to size through).
      if (line.driver === 'supply' || line.mode === 'chain') {
        const sol = renderChain(line, resultEl);
        machines = sol.totals.machines; power = sol.totals.power; targetKey = sol.targetItem;
        if (line.driver === 'supply') updateSupplyReadout(line, panel, sol.sizing);
      } else {
        const r = renderSingle(line, resultEl);
        machines = r.machines; power = r.power; targetKey = r.target;
      }
      line.targetItem = targetKey;
      panel.querySelector('.line-title').textContent = itemName(targetKey);
      panel.querySelector('.line-rate').textContent = fmt(line.targetRate) + '/min';
      panel.querySelector('.line-stats').textContent = fmt(machines) + '× · ' + fmt(power) + ' MW';
    }

    // Fill the "→ N/min" sized readout and the "available in factory" surplus hint
    // on a supply-driven line's form (the form itself isn't re-rendered each keystroke).
    function updateSupplyReadout(line, panel, sizing) {
      const sized = panel.querySelector('.sized-rate');
      if (sized) {
        sized.textContent = sizing.unbound
          ? "this path doesn't use " + itemName(line.sourceItem)
          : fmt(line.targetRate) + ' ' + itemName(line.targetItem) + '/min';
        sized.classList.toggle('muted', sizing.unbound);
      }
      const avail = panel.querySelector('.supply-avail');
      if (avail) {
        let have = 0;
        lines.forEach((other) => {
          if (other === line || !other.summary) return;
          (other.summary.supplies || []).forEach((s) => { if (s.item === line.sourceItem) have += s.rate; });
        });
        avail.innerHTML = have > 1e-9
          ? fmt(have) + '/min in factory <button type="button" class="use-surplus" data-rate="' + esc(have) + '">use</button>'
          : '';
      }
    }

    // ---- factory roll-up ----------------------------------------------------

    // A display name per line, derived from its product; duplicates get "#n".
    function lineNames() {
      const names = lines.map((l) => itemName(l.targetItem));
      const total = {};
      names.forEach((n) => { total[n] = (total[n] || 0) + 1; });
      const seen = {};
      return names.map((n) => {
        if (total[n] <= 1) return n;
        seen[n] = (seen[n] || 0) + 1;
        return n + ' #' + seen[n];
      });
    }

    function renderFactory() {
      const summaries = lines.map((l) => l.summary);
      if (lines.length <= 1 || summaries.some((s) => !s)) { factoryEl.hidden = true; factoryEl.innerHTML = ''; return; }
      const roll = rollUpFactory(dataset, summaries);
      const names = lineNames();

      const buildings = Object.keys(roll.byBuilding)
        .map((k) => [k, roll.byBuilding[k]])
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => fmt(m) + '× ' + esc(data.buildingName(dataset, k)))
        .join(' · ');

      const routesSection = roll.routes.length
        ? '<h3>Internal routes</h3>' +
          '<p class="muted tree-note">One line feeds another — plan belts/pipes accordingly. Split a line if a feed is awkward.</p>' +
          '<ul class="cols-list routes">' + roll.routes.map((r) =>
            '<li><span>' + fmt(r.rate) + '/min</span> ' + esc(itemName(r.item)) +
            ' <span class="muted">' + esc(names[r.from]) + ' → ' + esc(names[r.to]) + '</span></li>'
          ).join('') + '</ul>'
        : '';

      const unmetSection = roll.unmet.length
        ? '<h3>Required externally</h3>' +
          '<p class="muted tree-note">No line supplies these — bring them in from outside the factory.</p>' +
          '<ul class="cols-list">' + roll.unmet.map((u) =>
            '<li><span>' + fmt(u.rate) + '/min</span> ' + esc(itemName(u.item)) + '</li>'
          ).join('') + '</ul>'
        : '';

      const products = roll.outputs.filter((o) => o.product);
      const surplus = roll.outputs.filter((o) => !o.product);
      const productsList = products.length
        ? '<ul class="cols-list">' + products.map((o) =>
            '<li><span>' + fmt(o.rate) + '/min</span> ' + esc(itemName(o.item)) + '</li>'
          ).join('') + '</ul>'
        : '<p class="muted">none — every line\'s output is consumed internally.</p>';
      const surplusList = surplus.map((o) => {
        const cls = 'surplus' + (isFluid(o.item) ? ' fluid' : '');
        const hint = isFluid(o.item)
          ? ' <span class="hint">fluid surplus — needs a recycle loop or conversion to a sinkable product</span>'
          : '';
        return '<li><span class="' + cls + '">' + fmt(o.rate) + '/min</span> ' + esc(itemName(o.item)) + hint + '</li>';
      }).join('');
      const surplusSection = surplus.length
        ? '<h3>Surplus byproducts</h3><ul class="byproducts">' + surplusList + '</ul>'
        : '';

      const rawList = roll.raw.map((r) =>
        '<li><span>' + fmt(r.rate) + '/min</span> ' + esc(itemName(r.item)) + '</li>'
      ).join('') || '<li class="muted">none</li>';

      factoryEl.innerHTML =
        '<div class="headline"><span class="factory-label">Factory</span> ' +
        '<strong>' + fmt(roll.machines) + '</strong> machines' +
        '<span class="power">' + fmt(roll.power) + ' MW</span></div>' +
        '<div class="buildings muted">' + buildings + '</div>' +
        routesSection +
        unmetSection +
        '<div class="cols">' +
        '<div><h3>Factory outputs</h3>' + productsList + surplusSection + '</div>' +
        '<div><h3>Raw resources</h3><ul>' + rawList + '</ul></div>' +
        '</div>';
      factoryEl.hidden = false;
    }

    // ---- structure / bookmarks ---------------------------------------------

    function linePanelHTML(line, i) {
      const targetKey = line.targetItem;
      const supply = line.driver === 'supply';
      const driverTabs =
        '<div class="modes drivers" role="group" aria-label="How to drive this line">' +
          '<button type="button" class="chip driver' + (!supply ? ' active' : '') + '" data-driver="rate">Make an item</button>' +
          '<button type="button" class="chip driver' + (supply ? ' active' : '') + '" data-driver="supply">From a supply</button>' +
        '</div>';

      const body = supply
        ? driverTabs +
          '<div class="field"><label>Supply</label><select class="source-item" aria-label="Supply item">' + sourceOptions(line.sourceItem) + '</select></div>' +
          '<div class="field"><label>Available (per min)</label>' +
            '<input class="supply-rate" type="number" min="0" step="any" value="' + esc(line.supplyRate) + '" aria-label="Available supply per minute" />' +
            '<span class="supply-avail muted"></span></div>' +
          '<div class="field"><label>Make</label><select class="make-item" aria-label="End product to make">' + makeOptions(line) + '</select>' +
            '<div class="sized">→ <span class="sized-rate"></span></div></div>'
        : driverTabs +
          '<div class="modes" role="group" aria-label="Plan mode">' +
            '<button type="button" class="chip mode' + (line.mode === 'chain' ? ' active' : '') + '" data-mode="chain">Full chain</button>' +
            '<button type="button" class="chip mode' + (line.mode === 'single' ? ' active' : '') + '" data-mode="single">Single step</button>' +
          '</div>' +
          '<div class="field"><label>Item</label><select class="target-item" aria-label="Item to make">' + itemOptions(line.targetItem) + '</select></div>' +
          '<div class="field"><label>Target output (per min)</label>' +
            '<input class="rate" type="number" min="0" step="any" value="' + esc(line.targetRate) + '" aria-label="Target output per minute" /></div>';

      return '<section class="panel line' + (line.expanded ? '' : ' collapsed') + '" data-line="' + i + '">' +
        '<div class="line-head">' +
          '<button type="button" class="line-toggle" aria-label="Collapse or expand line"></button>' +
          '<strong class="line-title">' + esc(itemName(targetKey)) + '</strong> ' +
          '<span class="line-rate">' + fmt(line.targetRate) + '/min</span> ' +
          '<span class="line-stats muted"></span>' +
          '<button type="button" class="line-remove" aria-label="Remove line" title="Remove line">×</button>' +
        '</div>' +
        '<div class="line-body">' +
          '<form class="calc-form' + (supply ? ' supply-form' : '') + '">' + body + '</form>' +
          '<div class="result" aria-live="polite"></div>' +
        '</div>' +
      '</section>';
    }

    // Full structural rebuild — used on init, restore, add and remove. Safe to
    // blow away the forms here because it never runs mid-keystroke.
    function rebuild() {
      linesEl.innerHTML = lines.map((l, i) => linePanelHTML(l, i)).join('');
      lines.forEach((l, i) => {
        const panel = linesEl.children[i];
        renderLineResult(l, panel);
      });
      renderFactory();
      updateBookmark();
    }

    function setModeChips(panel, mode) {
      for (const b of panel.querySelectorAll('.mode')) b.classList.toggle('active', b.dataset.mode === mode);
    }

    function updateBookmark() {
      const entries = lines.map((l) => {
        const root = l.choices[l.targetItem];
        const isDefault = root && root === data.defaultRecipeForItem(dataset, l.targetItem);
        const chain = l.driver === 'supply' || l.mode === 'chain'; // supply lines are always a chain
        return {
          targetItem: l.targetItem,
          rootRecipe: (root && !isDefault) ? root : undefined, // store only a non-default pick
          targetRate: l.targetRate,
          choiceKeys: chain ? l.bmChoiceKeys : [],
          recycleItems: chain ? l.bmRecycle : [],
          providedItems: chain ? l.bmProvided : [],
          driver: l.driver,
          sourceItem: l.sourceItem,
          supplyRate: l.supplyRate,
        };
      });
      const bookmark = encodePlan({
        version: dataset.gameVersion, entries,
        costMult: mods.costMult, powerMult: mods.powerMult,
      });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    // A decoded entry's target item, deriving it from an old recipe-only bookmark.
    function entryTargetItem(e) {
      if (e.targetItem) return e.targetItem;
      const r = dataset.recipes[e.rootRecipe];
      return r ? r.outputs[0].item : null;
    }

    function entryToLine(e) {
      const targetItem = entryTargetItem(e);
      const choices = {};
      for (const k of e.choiceKeys || []) {
        const r = dataset.recipes[k];
        if (r) choices[r.outputs[0].item] = k;
      }
      // The root recipe is a per-item choice too — keep it only when non-default.
      if (e.rootRecipe && dataset.recipes[e.rootRecipe] &&
          e.rootRecipe !== data.defaultRecipeForItem(dataset, targetItem)) {
        choices[targetItem] = e.rootRecipe;
      }
      const l = newLine();
      l.targetItem = targetItem;
      l.targetRate = e.targetRate;
      l.choices = choices;
      l.recycle = new Set(e.recycleItems || []);
      l.provided = new Set(e.providedItems || []);
      // Supply-driven line: restore the source + amount (the target rate re-derives
      // on render). Ignore a stale/foreign source so the line still solves.
      if (e.driver === 'supply' && e.sourceItem && dataset.items[e.sourceItem]) {
        l.driver = 'supply';
        l.sourceItem = e.sourceItem;
        l.supplyRate = e.supplyRate != null ? e.supplyRate : l.supplyRate;
        reconcileSupplyTarget(l);
      }
      return l;
    }

    function restoreFromHash() {
      const hash = location.hash.slice(1);
      if (!hash) return false;
      try {
        const plan = decodePlan(hash);
        const entries = (plan.entries || []).filter((e) => {
          const ti = e && entryTargetItem(e);
          return ti && dataset.items[ti] && data.defaultRecipeForItem(dataset, ti);
        });
        if (!entries.length) return false;
        // Global multipliers travel with the plan; set them before solving so the
        // derived dataset is in place when entries (incl. supply sizing) are built.
        mods = { costMult: plan.costMult || 1, powerMult: plan.powerMult || 1 };
        applyMods();
        syncMultSelects();
        lines = entries.map(entryToLine);
        rebuild();
        return true;
      } catch (e) { /* not ours / malformed — ignore */ }
      return false;
    }

    // ---- events (delegated on the lines container) --------------------------

    linesEl.addEventListener('input', (e) => {
      const panel = e.target.closest('.line');
      if (!panel) return;
      const line = lines[+panel.dataset.line];
      if (e.target.matches('.rate')) line.targetRate = Number(e.target.value) || 0;
      else if (e.target.matches('.supply-rate')) line.supplyRate = Number(e.target.value) || 0;
      else return;
      renderLineResult(line, panel);   // form (incl. this input) is untouched → keeps focus
      renderFactory();
      updateBookmark();
    });

    linesEl.addEventListener('change', (e) => {
      const panel = e.target.closest('.line');
      if (!panel) return;
      const line = lines[+panel.dataset.line];

      if (e.target.matches('.source-item')) {
        // The supply changed → the reachable "Make" list does too, so rebuild the form.
        line.sourceItem = e.target.value;
        reconcileSupplyTarget(line);
        rebuild();
        return;
      }

      if (e.target.matches('.recycle-toggle')) {
        if (e.target.checked) line.recycle.add(e.target.dataset.item); else line.recycle.delete(e.target.dataset.item);
      } else if (e.target.matches('.provide-toggle')) {
        if (e.target.checked) line.provided.add(e.target.dataset.item); else line.provided.delete(e.target.dataset.item);
      } else if (e.target.matches('.target-item') || e.target.matches('.make-item')) {
        line.targetItem = e.target.value;
        delete line.choices[line.targetItem]; // new target starts on its default recipe
        if (line.driver === 'supply') ensureBoundPath(line); // …but on a path that uses the supply
      } else if (e.target.matches('.step-recipe')) {
        const item = e.target.dataset.item, key = e.target.value;
        // The target node picks the root recipe (default may be a byproduct source);
        // deeper nodes pick among their primary-product recipes.
        const def = item === line.targetItem
          ? data.defaultRecipeForItem(dataset, item)
          : data.defaultRecipeKey(dataset, item);
        if (key === def) delete line.choices[item];
        else line.choices[item] = key;
      } else {
        return;
      }
      renderLineResult(line, panel);
      renderFactory();
      updateBookmark();
    });

    linesEl.addEventListener('click', (e) => {
      const panel = e.target.closest('.line');
      if (!panel) return;
      const i = +panel.dataset.line;
      const line = lines[i];

      const drvBtn = e.target.closest('.driver');
      if (drvBtn) {
        const d = drvBtn.dataset.driver;
        if (d !== line.driver) {
          line.driver = d;
          if (d === 'supply') reconcileSupplyTarget(line); // land the target on a reachable item
          rebuild();
        }
        return;
      }
      const useS = e.target.closest('.use-surplus');
      if (useS) {
        line.supplyRate = Number(useS.dataset.rate) || 0;
        const inp = panel.querySelector('.supply-rate');
        if (inp) inp.value = line.supplyRate;
        renderLineResult(line, panel); renderFactory(); updateBookmark();
        return;
      }

      const modeBtn = e.target.closest('.mode');
      if (modeBtn) {
        if (modeBtn.dataset.mode !== line.mode) {
          line.mode = modeBtn.dataset.mode;
          setModeChips(panel, line.mode);
          renderLineResult(line, panel); renderFactory(); updateBookmark();
        }
        return;
      }
      const tg = e.target.closest('.tree-toggle');
      if (tg && !tg.classList.contains('empty')) {
        const collapsed = tg.closest('li').classList.toggle('collapsed');
        if (collapsed) line.collapsed.add(tg.dataset.path); else line.collapsed.delete(tg.dataset.path);
        return;
      }
      const lt = e.target.closest('.line-toggle');
      if (lt) {
        line.expanded = !line.expanded;
        panel.classList.toggle('collapsed', !line.expanded);
        return;
      }
      const rm = e.target.closest('.line-remove');
      if (rm) {
        lines.splice(i, 1);
        if (!lines.length) lines.push(newLine());
        rebuild();
        return;
      }
    });

    root.querySelector('#add-line').addEventListener('click', () => {
      lines.push(newLine());
      rebuild();
    });

    bookmarkEl.addEventListener('change', () => {
      location.hash = bookmarkEl.value.trim();
      restoreFromHash();
    });
    root.querySelector('#copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(bookmarkEl.value); } catch (e) { bookmarkEl.select(); }
    });

    fillMultSelect(costSel, COST_MULTS, mods.costMult);
    fillMultSelect(powerSel, POWER_MULTS, mods.powerMult);
    if (costSel) costSel.onchange = onModChange;   // assignment (not addEventListener) so a re-mount never stacks handlers
    if (powerSel) powerSel.onchange = onModChange;

    if (!restoreFromHash()) { lines = [newLine()]; rebuild(); }
  }

  BC.ui = BC.ui || {};
  BC.ui.mountPlanner = mountPlanner;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
