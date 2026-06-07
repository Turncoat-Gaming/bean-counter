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
    let targetItem = null;    // product of `active`, set during chain render
    let bookmarkChoiceKeys = []; // choices actually used by the current chain

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

    // The recipe cell for a step: a <select> of variants if there's more than one
    // (so it's selectable), otherwise just the name.
    function recipeCell(step) {
      const variants = data.recipesForItem(dataset, step.item);
      if (variants.length > 1) {
        const opts = variants.map((k) => {
          const r = dataset.recipes[k];
          const lbl = variantLabel(r.name) + (r.alternate ? ' (alt)' : '');
          return '<option value="' + esc(k) + '"' + (k === step.recipeKey ? ' selected' : '') + '>' + esc(lbl) + '</option>';
        }).join('');
        return '<select class="step-recipe" data-item="' + esc(step.item) +
          '" aria-label="Recipe for ' + esc(itemName(step.item)) + '">' + opts + '</select>';
      }
      const tag = step.alternate ? '<span class="tag">alt</span>' : '';
      return '<span class="rname">' + tag + esc(variantLabel(step.recipeName)) + '</span>';
    }

    function renderChain(targetRate) {
      const sol = solveChain(dataset, active, targetRate, { recipeChoices: choices });
      targetItem = sol.targetItem;

      // Which overrides are actually in play (for a tidy bookmark).
      const stepItems = new Set(sol.steps.map((s) => s.item));
      bookmarkChoiceKeys = Object.keys(choices)
        .filter((it) => stepItems.has(it) && it !== targetItem)
        .map((it) => choices[it]);

      const buildings = Object.keys(sol.totals.byBuilding)
        .map((k) => [k, sol.totals.byBuilding[k]])
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => fmt(m) + '× ' + esc(data.buildingName(dataset, k)))
        .join(' · ');

      const steps = sol.steps.map((s) =>
        '<li><span class="mach">' + fmt(s.machines) + '×</span> ' +
        '<span class="bld">' + esc(s.buildingName) + '</span> ' +
        recipeCell(s) +
        ' <span class="srate">' + fmt(s.rate) + '/min ' + esc(itemName(s.item)) + '</span></li>'
      ).join('');

      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(sol.totals.machines) + '</strong> machines' +
        '<span class="power">' + fmt(sol.totals.power) + ' MW</span></div>' +
        '<div class="buildings muted">' + buildings + '</div>' +
        '<h3>Production steps</h3><ul class="steps">' + steps + '</ul>' +
        '<div class="cols">' +
        '<div><h3>Raw resources</h3><ul>' + (flowList(sol.raw, (r) => r.rate, (r) => r.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul>' + (flowList(sol.byproducts, (b) => b.rate, (b) => b.item) || '<li class="muted">none</li>') + '</ul></div>' +
        '</div>' +
        (sol.warnings.length ? '<p class="error">' + sol.warnings.map(esc).join('<br>') + '</p>' : '');
    }

    function render() {
      const targetRate = Number(rateInput.value) || 0;
      if (mode === 'chain') renderChain(targetRate); else renderSingle(targetRate);

      const choiceKeys = mode === 'chain' ? bookmarkChoiceKeys : [];
      const bookmark = encodePlan({ version: dataset.gameVersion, entries: [{ recipeKey: active, targetRate, choiceKeys }] });
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
          if (first.choiceKeys && first.choiceKeys.length) setMode('chain');
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
    // Per-step recipe selection (deep alternates).
    resultEl.addEventListener('change', (e) => {
      const sel = e.target.closest('.step-recipe');
      if (!sel) return;
      const item = sel.dataset.item, key = sel.value;
      if (item === targetItem) { setActive(key); return; }   // target is driven by `active`
      if (data.defaultRecipeKey(dataset, item) === key) delete choices[item]; // back to default
      else choices[item] = key;
      render();
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
