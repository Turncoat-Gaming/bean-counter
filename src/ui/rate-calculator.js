// rate-calculator.js — the planner view. Owns DOM only; all math lives in the
// engine. Two modes: "Full chain" (recursive solve to raw resources, with
// per-step recipe selection) and "Single step" (just the selected recipe).
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
    const { solveChain } = BC.solver;
    const { encodePlan, decodePlan } = BC.codec;
    const itemName = (i) => data.itemName(dataset, i);

    root.innerHTML =
      '<form id="calc-form" class="panel">' +
      '  <div class="modes" role="group" aria-label="Plan mode">' +
      '    <button type="button" class="chip mode active" data-mode="chain">Full chain</button>' +
      '    <button type="button" class="chip mode" data-mode="single">Single step</button>' +
      '  </div>' +
      '  <div class="field"><label for="recipe">Recipe</label><select id="recipe"></select></div>' +
      '  <div class="field"><label for="rate">Target output (per min)</label>' +
      '    <input id="rate" type="number" min="0" step="any" value="60" /></div>' +
      '  <div id="variants" class="variants" hidden></div>' +
      '</form>' +
      '<section id="result" class="panel result" aria-live="polite"></section>' +
      '<section class="panel bookmark">' +
      '  <label for="bookmark">Bookmark (paste to restore a plan)</label>' +
      '  <div class="row"><input id="bookmark" type="text" spellcheck="false" />' +
      '    <button id="copy" type="button">Copy</button></div>' +
      '</section>';

    const recipeSel = root.querySelector('#recipe');
    const rateInput = root.querySelector('#rate');
    const variantsEl = root.querySelector('#variants');
    const modesEl = root.querySelector('.modes');
    const resultEl = root.querySelector('#result');
    const bookmarkEl = root.querySelector('#bookmark');

    let active = null;        // target recipe (may be an alternate)
    let mode = 'chain';
    let choices = {};         // per-step override: item -> recipeKey (deep alternates)
    let recycle = new Set();  // items whose byproducts are credited back (recycling on)
    let targetItem = null;    // product of `active`, set during chain render
    let bookmarkChoiceKeys = []; // choices actually used by the current chain
    let bookmarkRecycle = [];    // recycle toggles in play in the current chain
    let collapsedPaths = new Set(); // tree nodes the user has collapsed (by path)

    for (const [key, recipe] of data.pickerRecipes(dataset)) {
      const opt = document.createElement('option');
      opt.value = key;
      const per = perMachineRates(recipe).outputs[0].rate;
      const altN = data.alternateCount(dataset, key);
      opt.textContent =
        recipe.name + ' — ' + fmt(per) + '/min ' + itemName(primaryOutput(recipe).item) +
        (altN ? '  (+' + altN + ' alt)' : '');
      recipeSel.append(opt);
    }

    function renderVariants() {
      const variants = data.variantsForRecipe(dataset, active);
      if (variants.length <= 1) { variantsEl.hidden = true; variantsEl.innerHTML = ''; return; }
      const altN = data.alternateCount(dataset, active);
      const head = variants.length + ' recipes' + (altN ? ' · ' + altN + ' alternate' + (altN > 1 ? 's' : '') : '');
      let html = '<div class="variants-head">' + head + '</div><div class="chips">';
      for (const k of variants) {
        const r = dataset.recipes[k];
        const tag = r.alternate ? '<span class="tag">alt</span>' : '';
        html += '<button type="button" class="chip' + (k === active ? ' active' : '') + '"' +
          ' data-key="' + esc(k) + '">' + tag + esc(variantLabel(r.name)) + '</button>';
      }
      variantsEl.innerHTML = html + '</div>';
      variantsEl.hidden = false;
    }

    const flowList = (list, getRate, getItem) =>
      list.map((x) => '<li><span>' + fmt(getRate(x)) + '/min</span> ' + esc(itemName(getItem(x))) + '</li>').join('');

    function renderSingle(targetRate) {
      const plan = computeRecipePlan(dataset, active, targetRate);
      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(plan.machines) + '</strong> × ' + esc(plan.buildingName) +
        '<span class="power">' + fmt(plan.power) + ' MW</span></div>' +
        '<div class="cols">' +
        '<div><h3>Inputs</h3><ul>' + (flowList(plan.inputs, (f) => f.rate, (f) => f.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul>' + (flowList(plan.byproducts, (f) => f.rate, (f) => f.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '</div>';
    }

    // The recipe cell for a step: a <select> of variants where there's a choice,
    // otherwise empty (the Item column already names what's produced). This makes
    // the Recipe column the "where can I pick an alternate" column.
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

    // Read-only recipe label for the totals table.
    function recipeName(step) {
      const tag = step.alternate ? '<span class="tag">alt</span>' : '';
      return tag + esc(variantLabel(step.recipeName));
    }

    // A "♻ reuse" checkbox for an item that has a byproduct source to pull from
    // (rendered on its production / raw-draw row). Empty for non-recyclable rows.
    function recycleToggle(x) {
      if (!x.recyclable) return '';
      return '<label class="recycle" title="Reuse this item\'s byproduct supply">' +
        '<input type="checkbox" class="recycle-toggle" data-item="' + esc(x.item) + '"' +
        (x.recycling ? ' checked' : '') + '> ♻</label>';
    }

    // One node of the production tree (nested <ul> gives the indentation).
    // `path` is the unique route from the root, so collapse state survives
    // re-renders and applies to the right occurrence of a shared item.
    function treeNode(node, path) {
      const hasKids = node.children && node.children.length;
      const toggle = hasKids
        ? '<button type="button" class="tree-toggle" data-path="' + esc(path) + '" aria-label="Collapse or expand"></button>'
        : '<span class="tree-toggle empty"></span>';

      const body = node.raw
        ? toggle + '<span class="raw-tag">raw</span> ' +
          '<span class="item">' + esc(itemName(node.item)) + '</span> ' +
          '<span class="rate">' + fmt(node.rate) + '/min</span>'
        : toggle +
          '<span class="mach">' + fmt(node.machines) + '×</span> ' +
          '<span class="bld">' + esc(node.buildingName) + '</span> ' +
          '<span class="item">' + esc(itemName(node.item)) + '</span> ' +
          '<span class="rate">' + fmt(node.rate) + '/min</span> ' +
          recipeCell(node);

      const collapsed = hasKids && collapsedPaths.has(path);
      let html = '<li class="' + (collapsed ? 'collapsed' : '') + '"><div class="node">' + body + '</div>';
      if (hasKids) {
        html += '<ul>' + node.children.map((c) => treeNode(c, path + '>' + c.item)).join('') + '</ul>';
      }
      return html + '</li>';
    }

    function renderChain(targetRate) {
      const sol = solveChain(dataset, active, targetRate, { recipeChoices: choices, recycle: [...recycle] });
      targetItem = sol.targetItem;

      // Which overrides are actually in play (for a tidy bookmark).
      const stepItems = new Set(sol.steps.map((s) => s.item));
      bookmarkChoiceKeys = Object.keys(choices)
        .filter((it) => stepItems.has(it) && it !== targetItem)
        .map((it) => choices[it]);

      // Recycle toggles relevant to this chain (an item with a byproduct source).
      const recyclableNow = new Set();
      sol.steps.forEach((s) => { if (s.recyclable) recyclableNow.add(s.item); });
      sol.raw.forEach((r) => { if (r.recyclable) recyclableNow.add(r.item); });
      bookmarkRecycle = [...recycle].filter((it) => recyclableNow.has(it));

      const buildings = Object.keys(sol.totals.byBuilding)
        .map((k) => [k, sol.totals.byBuilding[k]])
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => fmt(m) + '× ' + esc(data.buildingName(dataset, k)))
        .join(' · ');

      const tree = '<ul class="tree">' + treeNode(sol.tree, sol.tree.item) + '</ul>';

      const rows = sol.steps.map((s) =>
        '<tr>' +
        '<td class="mach">' + fmt(s.machines) + '×</td>' +
        '<td class="bld">' + esc(s.buildingName) + '</td>' +
        '<td class="item">' + esc(itemName(s.item)) + ' ' + recycleToggle(s) + '</td>' +
        '<td class="rate">' + fmt(s.rate) + '/min</td>' +
        '<td class="rec">' + recipeName(s) + '</td>' +
        '</tr>'
      ).join('');

      const totalsTable =
        '<div class="steps-wrap"><table class="steps"><thead><tr>' +
        '<th class="mach">Qty</th><th>Building</th><th>Item</th><th class="rate">Rate</th><th>Recipe</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>';

      const rawList = sol.raw.map((r) =>
        '<li><span>' + fmt(r.rate) + '/min</span> ' + esc(itemName(r.item)) + ' ' + recycleToggle(r) + '</li>'
      ).join('') || '<li class="muted">none</li>';

      // Byproducts: surplus is what you must sink/loop; show reused amount too.
      // Fluids/gases can't go to the AWESOME Sink, so their surplus is flagged hard.
      const byproductList = sol.byproducts.map((b) => {
        const reused = b.credited > 0 ? ' <span class="muted">(' + fmt(b.credited) + '/min reused)</span>' : '';
        if (b.surplus <= 0) {
          return '<li><span>0/min</span> surplus ' + esc(itemName(b.item)) + reused + '</li>';
        }
        const cls = 'surplus' + (b.fluid ? ' fluid' : '');
        const hint = b.fluid
          ? '<span class="hint">fluid surplus — needs a recycle loop or conversion to a sinkable product</span>'
          : (b.recyclable && !b.recycling ? '<span class="hint">tick ♻ on its step to reuse it</span>' : '');
        return '<li><span class="' + cls + '">' + fmt(b.surplus) + '/min</span> surplus ' +
          esc(itemName(b.item)) + reused + (hint ? ' ' + hint : '') + '</li>';
      }).join('') || '<li class="muted">none</li>';

      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(sol.totals.machines) + '</strong> machines' +
        '<span class="power">' + fmt(sol.totals.power) + ' MW</span></div>' +
        '<div class="buildings muted">' + buildings + '</div>' +
        '<h3>Production tree</h3>' +
        '<p class="muted tree-note">Pick a recipe on any node — it applies to that item across the whole plan. The tree shows gross flow; Totals below reflect any recycling.</p>' +
        tree +
        '<h3>Totals</h3>' +
        '<p class="muted tree-note">Tick ♻ on a step to reuse a byproduct of that item — it credits against demand, cutting machines and raw draw.</p>' +
        totalsTable +
        '<div class="cols">' +
        '<div><h3>Raw resources</h3><ul>' + rawList + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul class="byproducts">' + byproductList + '</ul></div>' +
        '</div>' +
        (sol.warnings.length ? '<p class="error">' + sol.warnings.map(esc).join('<br>') + '</p>' : '');
    }

    function render() {
      const targetRate = Number(rateInput.value) || 0;
      if (mode === 'chain') renderChain(targetRate); else renderSingle(targetRate);

      const choiceKeys = mode === 'chain' ? bookmarkChoiceKeys : [];
      const recycleItems = mode === 'chain' ? bookmarkRecycle : [];
      const bookmark = encodePlan({ version: dataset.gameVersion, entries: [{ recipeKey: active, targetRate, choiceKeys, recycleItems }] });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    function setActive(key) {
      active = key;
      recipeSel.value = data.representativeKey(dataset, key);
      renderVariants();
      render();
    }

    function setMode(m) {
      mode = m;
      for (const b of modesEl.querySelectorAll('.mode')) b.classList.toggle('active', b.dataset.mode === m);
    }

    // Rebuild the choices map from a bookmark's recipe keys (item = recipe's product).
    function applyChoiceKeys(keys) {
      choices = {};
      for (const k of keys || []) {
        const r = dataset.recipes[k];
        if (r) choices[r.outputs[0].item] = k;
      }
    }

    function restoreFromHash() {
      const hash = location.hash.slice(1);
      if (!hash) return false;
      try {
        const first = decodePlan(hash).entries[0];
        if (first && dataset.recipes[first.recipeKey]) {
          rateInput.value = first.targetRate;
          applyChoiceKeys(first.choiceKeys);
          recycle = new Set(first.recycleItems || []);
          if ((first.choiceKeys && first.choiceKeys.length) || recycle.size) setMode('chain');
          setActive(first.recipeKey);
          return true;
        }
      } catch (e) { /* not ours / malformed — ignore */ }
      return false;
    }

    recipeSel.addEventListener('change', () => setActive(recipeSel.value));
    rateInput.addEventListener('input', render);
    variantsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) setActive(chip.dataset.key);
    });
    // Per-step recipe selection (deep alternates) and recycle toggles.
    resultEl.addEventListener('change', (e) => {
      const rec = e.target.closest('.recycle-toggle');
      if (rec) {
        if (rec.checked) recycle.add(rec.dataset.item); else recycle.delete(rec.dataset.item);
        render();
        return;
      }
      const sel = e.target.closest('.step-recipe');
      if (!sel) return;
      const item = sel.dataset.item, key = sel.value;
      if (item === targetItem) { setActive(key); return; }   // target is driven by `active`
      if (data.defaultRecipeKey(dataset, item) === key) delete choices[item]; // back to default
      else choices[item] = key;
      render();
    });
    // Collapse/expand a tree node (no re-solve needed — just toggle the class).
    resultEl.addEventListener('click', (e) => {
      const t = e.target.closest('.tree-toggle');
      if (!t || t.classList.contains('empty')) return;
      const collapsed = t.closest('li').classList.toggle('collapsed');
      if (collapsed) collapsedPaths.add(t.dataset.path); else collapsedPaths.delete(t.dataset.path);
    });
    modesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode');
      if (!btn || btn.dataset.mode === mode) return;
      setMode(btn.dataset.mode);
      render();
    });
    bookmarkEl.addEventListener('change', () => {
      location.hash = bookmarkEl.value.trim();
      restoreFromHash();
    });
    root.querySelector('#copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(bookmarkEl.value); } catch (e) { bookmarkEl.select(); }
    });

    if (!restoreFromHash()) setActive(recipeSel.value);
  }

  BC.ui = BC.ui || {};
  BC.ui.mountPlanner = mountPlanner;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
