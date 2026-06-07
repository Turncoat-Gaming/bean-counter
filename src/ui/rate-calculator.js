// rate-calculator.js — the MVP view. Owns DOM only; all math lives in the engine.
// Classic script: exposes BeanCounter.ui.mountRateCalculator (loads over file://).
(function (BC) {
  'use strict';

  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // Escape any value before it goes into innerHTML. Today recipe/item names come
  // from the trusted committed dataset, but this keeps us safe if a future
  // feature ever renders user-imported data or bookmark-provided text.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Drop the "Alternate: " prefix for display — the "alt" tag carries that info.
  const variantLabel = (name) => name.replace(/^Alternate:\s*/, '');

  function mountRateCalculator(root, dataset) {
    const data = BC.data;
    const { computeRecipePlan, primaryOutput, perMachineRates } = BC.calculator;
    const { encodePlan, decodePlan } = BC.codec;

    root.innerHTML =
      '<form id="calc-form" class="panel">' +
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
    const resultEl = root.querySelector('#result');
    const bookmarkEl = root.querySelector('#bookmark');

    // The currently active recipe (may be an alternate, even though the dropdown
    // shows its standard representative).
    let active = null;

    // Populate the picker (alternates suppressed). Flag entries that have alternates.
    for (const [key, recipe] of data.pickerRecipes(dataset)) {
      const opt = document.createElement('option');
      opt.value = key;
      const per = perMachineRates(recipe).outputs[0].rate;
      const altN = data.alternateCount(dataset, key);
      opt.textContent =
        recipe.name + ' — ' + fmt(per) + '/min ' + data.itemName(dataset, primaryOutput(recipe).item) +
        (altN ? '  (+' + altN + ' alt)' : '');
      recipeSel.append(opt);
    }

    function renderVariants() {
      const variants = data.variantsForRecipe(dataset, active);
      if (variants.length <= 1) { variantsEl.hidden = true; variantsEl.innerHTML = ''; return; }

      const altN = data.alternateCount(dataset, active);
      const head = variants.length + ' recipes' +
        (altN ? ' · ' + altN + ' alternate' + (altN > 1 ? 's' : '') : '');

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

    function render() {
      const targetRate = Number(rateInput.value) || 0;
      const plan = computeRecipePlan(dataset, active, targetRate);

      const flows = (list) =>
        list.map((f) => '<li><span>' + fmt(f.rate) + '/min</span> ' + esc(data.itemName(dataset, f.item)) + '</li>').join('');

      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(plan.machines) + '</strong> × ' + esc(plan.buildingName) +
        '<span class="power">' + fmt(plan.power) + ' MW</span></div>' +
        '<div class="cols">' +
        '<div><h3>Inputs</h3><ul>' + (flows(plan.inputs) || '<li class="muted">none</li>') + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul>' + (flows(plan.byproducts) || '<li class="muted">none</li>') + '</ul></div>' +
        '</div>';

      const bookmark = encodePlan({ version: dataset.gameVersion, entries: [{ recipeKey: active, targetRate }] });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    // Make `key` the active recipe: sync the dropdown to its representative, redraw.
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

    // Changing the dropdown picks that (standard) recipe; alternates reset to it.
    recipeSel.addEventListener('change', () => setActive(recipeSel.value));
    rateInput.addEventListener('input', render);
    variantsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) setActive(chip.dataset.key);
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
  BC.ui.mountRateCalculator = mountRateCalculator;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
