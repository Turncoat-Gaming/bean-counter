// rate-calculator.js — the planner view. Owns DOM only; all math lives in the
// engine. A doc holds one or more *lines* (one factory), shown as a stacked
// accordion. Each line is the old single-plan planner: a target recipe + rate
// with per-item recipe choices, ♻ recycle and 📦 supply-externally toggles, in
// "Full chain" or "Single step" mode. A factory summary nets the lines together
// and shows which line feeds which (the seam for factories/tabs later).
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
    const { computeRecipePlan, primaryOutput, perMachineRates } = BC.calculator;
    const { solveChain, rollUpFactory } = BC.solver;
    const { encodePlan, decodePlan } = BC.codec;
    const itemName = (i) => data.itemName(dataset, i);
    const isFluid = (i) => { const it = dataset.items[i]; return !!it && (it.form === 'liquid' || it.form === 'gas'); };

    // The recipe picker is the same for every line — precompute its <option>s.
    const pickerList = [];
    for (const [key, recipe] of data.pickerRecipes(dataset)) {
      const per = perMachineRates(recipe).outputs[0].rate;
      const altN = data.alternateCount(dataset, key);
      pickerList.push({
        key,
        label: recipe.name + ' — ' + fmt(per) + '/min ' + itemName(primaryOutput(recipe).item) +
          (altN ? '  (+' + altN + ' alt)' : ''),
      });
    }
    const firstRecipeKey = pickerList[0] && pickerList[0].key;
    const recipeOptions = (activeKey) => {
      const rep = data.representativeKey(dataset, activeKey);
      return pickerList.map(({ key, label }) =>
        '<option value="' + esc(key) + '"' + (key === rep ? ' selected' : '') + '>' + esc(label) + '</option>'
      ).join('');
    };

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
        active: firstRecipeKey, targetRate: 60, mode: 'chain',
        choices: {}, recycle: new Set(), provided: new Set(),
        collapsed: new Set(),  // tree nodes collapsed (by path)
        expanded: true,        // accordion open
        targetItem: null,
        summary: null,         // normalized {target,supplies,demands,raw,...} for the roll-up
        bmChoiceKeys: [], bmRecycle: [], bmProvided: [], // in-play overrides for the bookmark
      };
    }

    // ---- shared HTML helpers (operate on a node/step, no globals) -----------

    const flowList = (list, getRate, getItem) =>
      list.map((x) => '<li><span>' + fmt(getRate(x)) + '/min</span> ' + esc(itemName(getItem(x))) + '</li>').join('');

    // Recipe <select> for a step where there's a choice; empty otherwise.
    function recipeCell(step) {
      const variants = data.recipesForItem(dataset, step.item);
      if (variants.length <= 1) return '';
      const opts = variants.map((k) => {
        const r = dataset.recipes[k];
        const lbl = variantLabel(r.name) + (r.alternate ? ' (alt)' : '');
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
    function treeNode(node, path, collapsedSet) {
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
      } else {                               // built here
        body = toggle +
          '<span class="mach">' + fmt(node.machines) + '×</span> ' +
          '<span class="bld">' + esc(node.buildingName) + '</span> ' +
          name + recipeCell(node) + recycleToggle(node) + provideToggle(node);
      }

      const collapsed = hasKids && collapsedSet.has(path);
      let html = '<li class="' + (collapsed ? 'collapsed' : '') + '"><div class="node">' + body + '</div>';
      if (hasKids) {
        html += '<ul>' + node.children.map((c) => treeNode(c, path + '>' + c.item, collapsedSet)).join('') + '</ul>';
      }
      return html + '</li>';
    }

    // ---- per-line rendering -------------------------------------------------

    function renderVariants(line, panel) {
      const variantsEl = panel.querySelector('.variants');
      const variants = data.variantsForRecipe(dataset, line.active);
      if (variants.length <= 1) { variantsEl.hidden = true; variantsEl.innerHTML = ''; return; }
      const altN = data.alternateCount(dataset, line.active);
      const head = variants.length + ' recipes' + (altN ? ' · ' + altN + ' alternate' + (altN > 1 ? 's' : '') : '');
      let html = '<div class="variants-head">' + head + '</div><div class="chips">';
      for (const k of variants) {
        const r = dataset.recipes[k];
        const tag = r.alternate ? '<span class="tag">alt</span>' : '';
        html += '<button type="button" class="chip' + (k === line.active ? ' active' : '') + '"' +
          ' data-key="' + esc(k) + '">' + tag + esc(variantLabel(r.name)) + '</button>';
      }
      variantsEl.innerHTML = html + '</div>';
      variantsEl.hidden = false;
    }

    // Full chain: solve, render into the line's .result, stash its roll-up
    // summary + bookmark scratch, and return the solution (for head stats).
    function renderChain(line, resultEl) {
      const sol = solveChain(dataset, line.active, line.targetRate, {
        recipeChoices: line.choices, recycle: [...line.recycle], provided: [...line.provided],
      });
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

      const tree = '<ul class="tree">' + treeNode(sol.tree, sol.tree.item, line.collapsed) + '</ul>';

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

    // Single step: just the selected recipe.
    function renderSingle(line, resultEl) {
      const plan = computeRecipePlan(dataset, line.active, line.targetRate);
      const recipe = dataset.recipes[line.active];
      const target = primaryOutput(recipe).item;
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
      if (line.mode === 'chain') {
        const sol = renderChain(line, resultEl);
        machines = sol.totals.machines; power = sol.totals.power; targetKey = sol.targetItem;
      } else {
        const r = renderSingle(line, resultEl);
        machines = r.machines; power = r.power; targetKey = r.target;
      }
      line.targetItem = targetKey;
      panel.querySelector('.line-title').textContent = itemName(targetKey);
      panel.querySelector('.line-rate').textContent = fmt(line.targetRate) + '/min';
      panel.querySelector('.line-stats').textContent = fmt(machines) + '× · ' + fmt(power) + ' MW';
    }

    // ---- factory roll-up ----------------------------------------------------

    // A display name per line, derived from its product; duplicates get "#n".
    function lineNames() {
      const names = lines.map((l) => itemName(l.targetItem || primaryOutput(dataset.recipes[l.active]).item));
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
      const targetKey = line.targetItem || primaryOutput(dataset.recipes[line.active]).item;
      return '<section class="panel line' + (line.expanded ? '' : ' collapsed') + '" data-line="' + i + '">' +
        '<div class="line-head">' +
          '<button type="button" class="line-toggle" aria-label="Collapse or expand line"></button>' +
          '<strong class="line-title">' + esc(itemName(targetKey)) + '</strong> ' +
          '<span class="line-rate">' + fmt(line.targetRate) + '/min</span> ' +
          '<span class="line-stats muted"></span>' +
          '<button type="button" class="line-remove" aria-label="Remove line" title="Remove line">×</button>' +
        '</div>' +
        '<div class="line-body">' +
          '<form class="calc-form">' +
            '<div class="modes" role="group" aria-label="Plan mode">' +
              '<button type="button" class="chip mode' + (line.mode === 'chain' ? ' active' : '') + '" data-mode="chain">Full chain</button>' +
              '<button type="button" class="chip mode' + (line.mode === 'single' ? ' active' : '') + '" data-mode="single">Single step</button>' +
            '</div>' +
            '<div class="field"><label>Recipe</label><select class="recipe" aria-label="Recipe">' + recipeOptions(line.active) + '</select></div>' +
            '<div class="field"><label>Target output (per min)</label>' +
              '<input class="rate" type="number" min="0" step="any" value="' + esc(line.targetRate) + '" aria-label="Target output per minute" /></div>' +
            '<div class="variants" hidden></div>' +
          '</form>' +
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
        renderVariants(l, panel);
        renderLineResult(l, panel);
      });
      renderFactory();
      updateBookmark();
    }

    function setActive(line, panel, key) {
      line.active = key;
      panel.querySelector('.recipe').value = data.representativeKey(dataset, key);
      renderVariants(line, panel);
      renderLineResult(line, panel);
      renderFactory();
      updateBookmark();
    }

    function setModeChips(panel, mode) {
      for (const b of panel.querySelectorAll('.mode')) b.classList.toggle('active', b.dataset.mode === mode);
    }

    function updateBookmark() {
      const entries = lines.map((l) => ({
        recipeKey: l.active, targetRate: l.targetRate,
        choiceKeys: l.mode === 'chain' ? l.bmChoiceKeys : [],
        recycleItems: l.mode === 'chain' ? l.bmRecycle : [],
        providedItems: l.mode === 'chain' ? l.bmProvided : [],
      }));
      const bookmark = encodePlan({ version: dataset.gameVersion, entries });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    function entryToLine(e) {
      const choices = {};
      for (const k of e.choiceKeys || []) {
        const r = dataset.recipes[k];
        if (r) choices[r.outputs[0].item] = k;
      }
      const l = newLine();
      l.active = e.recipeKey;
      l.targetRate = e.targetRate;
      l.choices = choices;
      l.recycle = new Set(e.recycleItems || []);
      l.provided = new Set(e.providedItems || []);
      return l;
    }

    function restoreFromHash() {
      const hash = location.hash.slice(1);
      if (!hash) return false;
      try {
        const entries = (decodePlan(hash).entries || []).filter((e) => e && dataset.recipes[e.recipeKey]);
        if (!entries.length) return false;
        lines = entries.map(entryToLine);
        rebuild();
        return true;
      } catch (e) { /* not ours / malformed — ignore */ }
      return false;
    }

    // ---- events (delegated on the lines container) --------------------------

    linesEl.addEventListener('input', (e) => {
      if (!e.target.matches('.rate')) return;
      const panel = e.target.closest('.line');
      const line = lines[+panel.dataset.line];
      line.targetRate = Number(e.target.value) || 0;
      renderLineResult(line, panel);   // form (incl. this input) is untouched → keeps focus
      renderFactory();
      updateBookmark();
    });

    linesEl.addEventListener('change', (e) => {
      const panel = e.target.closest('.line');
      if (!panel) return;
      const line = lines[+panel.dataset.line];

      if (e.target.matches('.recycle-toggle')) {
        if (e.target.checked) line.recycle.add(e.target.dataset.item); else line.recycle.delete(e.target.dataset.item);
      } else if (e.target.matches('.provide-toggle')) {
        if (e.target.checked) line.provided.add(e.target.dataset.item); else line.provided.delete(e.target.dataset.item);
      } else if (e.target.matches('.recipe')) {
        setActive(line, panel, e.target.value);
        return;
      } else if (e.target.matches('.step-recipe')) {
        const item = e.target.dataset.item, key = e.target.value;
        if (item === line.targetItem) { setActive(line, panel, key); return; }
        if (data.defaultRecipeKey(dataset, item) === key) delete line.choices[item];
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

      const modeBtn = e.target.closest('.mode');
      if (modeBtn) {
        if (modeBtn.dataset.mode !== line.mode) {
          line.mode = modeBtn.dataset.mode;
          setModeChips(panel, line.mode);
          renderLineResult(line, panel); renderFactory(); updateBookmark();
        }
        return;
      }
      const chip = e.target.closest('.variants .chip');
      if (chip) { setActive(line, panel, chip.dataset.key); return; }

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

    if (!restoreFromHash()) { lines = [newLine()]; rebuild(); }
  }

  BC.ui = BC.ui || {};
  BC.ui.mountPlanner = mountPlanner;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
