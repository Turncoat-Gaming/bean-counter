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

  function mountRateCalculator(root, dataset) {
    const { recipeList, itemName } = BC.data;
    const { computeRecipePlan, primaryOutput, perMachineRates } = BC.calculator;
    const { encodePlan, decodePlan } = BC.codec;

    root.innerHTML =
      '<form id="calc-form" class="panel">' +
      '  <div class="field"><label for="recipe">Recipe</label><select id="recipe"></select></div>' +
      '  <div class="field"><label for="rate">Target output (per min)</label>' +
      '    <input id="rate" type="number" min="0" step="any" value="60" /></div>' +
      '</form>' +
      '<section id="result" class="panel result" aria-live="polite"></section>' +
      '<section class="panel bookmark">' +
      '  <label for="bookmark">Bookmark (paste to restore a plan)</label>' +
      '  <div class="row"><input id="bookmark" type="text" spellcheck="false" />' +
      '    <button id="copy" type="button">Copy</button></div>' +
      '</section>';

    const recipeSel = root.querySelector('#recipe');
    const rateInput = root.querySelector('#rate');
    const resultEl = root.querySelector('#result');
    const bookmarkEl = root.querySelector('#bookmark');

    for (const [key, recipe] of recipeList(dataset)) {
      const opt = document.createElement('option');
      opt.value = key;
      const per = perMachineRates(recipe).outputs[0].rate;
      opt.textContent = recipe.name + ' — ' + fmt(per) + '/min ' + itemName(dataset, primaryOutput(recipe).item);
      recipeSel.append(opt);
    }

    function render() {
      const recipeKey = recipeSel.value;
      const targetRate = Number(rateInput.value) || 0;
      const plan = computeRecipePlan(dataset, recipeKey, targetRate);

      const flows = (list) =>
        list.map((f) => '<li><span>' + fmt(f.rate) + '/min</span> ' + esc(itemName(dataset, f.item)) + '</li>').join('');

      resultEl.innerHTML =
        '<div class="headline"><strong>' + fmt(plan.machines) + '</strong> × ' + esc(plan.buildingName) +
        '<span class="power">' + fmt(plan.power) + ' MW</span></div>' +
        '<div class="cols">' +
        '<div><h3>Inputs</h3><ul>' + (flows(plan.inputs) || '<li class="muted">none</li>') + '</ul></div>' +
        '<div><h3>Byproducts</h3><ul>' + (flows(plan.byproducts) || '<li class="muted">none</li>') + '</ul></div>' +
        '</div>';

      const bookmark = encodePlan({ version: dataset.gameVersion, entries: [{ recipeKey, targetRate }] });
      bookmarkEl.value = bookmark;
      history.replaceState(null, '', '#' + bookmark);
    }

    function restoreFromHash() {
      const hash = location.hash.slice(1);
      if (!hash) return false;
      try {
        const first = decodePlan(hash).entries[0];
        if (first && dataset.recipes[first.recipeKey]) {
          recipeSel.value = first.recipeKey;
          rateInput.value = first.targetRate;
          return true;
        }
      } catch (e) { /* not ours / malformed — ignore */ }
      return false;
    }

    recipeSel.addEventListener('change', render);
    rateInput.addEventListener('input', render);
    bookmarkEl.addEventListener('change', () => {
      location.hash = bookmarkEl.value.trim();
      if (restoreFromHash()) render();
    });
    root.querySelector('#copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(bookmarkEl.value); } catch (e) { bookmarkEl.select(); }
    });

    restoreFromHash();
    render();
  }

  BC.ui = BC.ui || {};
  BC.ui.mountRateCalculator = mountRateCalculator;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
