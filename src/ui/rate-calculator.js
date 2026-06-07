// rate-calculator.js — the planner view. Owns DOM only; all math lives in the
// engine. Two modes: "Full chain" (recursive solve to raw resources) and
// "Single step" (just the selected recipe). Classic script: exposes
// BeanCounter.ui.mountPlanner (loads over file://).
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

    let active = null;       // current recipe (may be an alternate)
    let mode = 'chain';

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

    function renderChain(targetRate) {
      const sol = solveChain(dataset, active, targetRate);

      const buildings = Object.keys(sol.totals.byBuilding)
        .map((k) => [k, sol.totals.byBuilding[k]])
        .sort((a, b) => b[1] - a[1])
        .map(([k, m]) => fmt(m) + '× ' + esc(data.buildingName(dataset, k)))
        .join(' · ');

      const steps = sol.steps.map((s) => {
        const tag = s.alternate ? '<span class="tag">alt</span>' : '';
        return '<li><span class="mach">' + fmt(s.machines) + '×</span> ' +
          '<span class="bld">' + esc(s.buildingName) + '</span> ' +
          '<span class="rname">' + tag + esc(variantLabel(s.recipeName)) + '</span> ' +
          '<span class="srate">' + fmt(s.rate) + '/min ' + esc(itemName(s.item)) + '</span></li>';
      }).join('');

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

      const bookmark = encodePlan({ version: dataset.gameVersion, entries: [{ recipeKey: active, targetRate }] });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    function setActive(key) {
      active = key;
      recipeSel.value = data.representativeKey(dataset, key);
      renderVariants();
      render();
    }

    function restoreFromHash() {
      const hash = location.hash.slice(1);
      if (!hash) return false;
      try {
        const first = decodePlan(hash).entries[0];
        if (first && dataset.recipes[first.recipeKey]) {
          rateInput.value = first.targetRate;
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
    modesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode');
      if (!btn || btn.dataset.mode === mode) return;
      mode = btn.dataset.mode;
      for (const b of modesEl.querySelectorAll('.mode')) b.classList.toggle('active', b === btn);
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
