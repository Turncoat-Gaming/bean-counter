// rate-calculator.js — the MVP view. Owns DOM only; all math lives in the engine.
// Renders a recipe picker + target-rate input, shows machines/inputs/byproducts/
// power, and keeps a shareable bookmark (URL hash) in sync with the plan.

import { recipeList, itemName } from '../engine/dataset.js';
import { computeRecipePlan, primaryOutput, perMachineRates } from '../engine/calculator.js';
import { encodePlan, decodePlan } from '../engine/plan-codec.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function mountRateCalculator(root, dataset) {
  root.innerHTML = `
    <form id="calc-form" class="panel">
      <div class="field">
        <label for="recipe">Recipe</label>
        <select id="recipe"></select>
      </div>
      <div class="field">
        <label for="rate">Target output (per min)</label>
        <input id="rate" type="number" min="0" step="any" value="60" />
      </div>
    </form>
    <section id="result" class="panel result" aria-live="polite"></section>
    <section class="panel bookmark">
      <label for="bookmark">Bookmark (paste to restore a plan)</label>
      <div class="row">
        <input id="bookmark" type="text" spellcheck="false" />
        <button id="copy" type="button">Copy</button>
      </div>
    </section>
  `;

  const recipeSel = root.querySelector('#recipe');
  const rateInput = root.querySelector('#rate');
  const resultEl = root.querySelector('#result');
  const bookmarkEl = root.querySelector('#bookmark');

  for (const [key, recipe] of recipeList(dataset)) {
    const opt = document.createElement('option');
    opt.value = key;
    const primary = primaryOutput(recipe);
    const per = perMachineRates(recipe).outputs[0].rate;
    opt.textContent = `${recipe.name} — ${fmt(per)}/min ${itemName(dataset, primary.item)}`;
    recipeSel.append(opt);
  }

  function render() {
    const recipeKey = recipeSel.value;
    const targetRate = Number(rateInput.value) || 0;
    const plan = computeRecipePlan(dataset, recipeKey, targetRate);

    const flows = (list) =>
      list.map((f) => `<li><span>${fmt(f.rate)}/min</span> ${itemName(dataset, f.item)}</li>`).join('');

    resultEl.innerHTML = `
      <div class="headline">
        <strong>${fmt(plan.machines)}</strong> × ${plan.buildingName}
        <span class="power">${fmt(plan.power)} MW</span>
      </div>
      <div class="cols">
        <div><h3>Inputs</h3><ul>${flows(plan.inputs) || '<li class="muted">none</li>'}</ul></div>
        <div><h3>Byproducts</h3><ul>${flows(plan.byproducts) || '<li class="muted">none</li>'}</ul></div>
      </div>
    `;

    const bookmark = encodePlan({
      version: dataset.gameVersion,
      entries: [{ recipeKey, targetRate }],
    });
    bookmarkEl.value = bookmark;
    history.replaceState(null, '', '#' + bookmark);
  }

  // Restore from URL hash (a shared link) if present and valid.
  function restoreFromHash() {
    const hash = location.hash.slice(1);
    if (!hash) return false;
    try {
      const plan = decodePlan(hash);
      const first = plan.entries[0];
      if (first && dataset.recipes[first.recipeKey]) {
        recipeSel.value = first.recipeKey;
        rateInput.value = first.targetRate;
        return true;
      }
    } catch { /* not ours / malformed — ignore */ }
    return false;
  }

  recipeSel.addEventListener('change', render);
  rateInput.addEventListener('input', render);
  bookmarkEl.addEventListener('change', () => {
    location.hash = bookmarkEl.value.trim();
    if (restoreFromHash()) render();
  });
  root.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(bookmarkEl.value); } catch { bookmarkEl.select(); }
  });

  restoreFromHash();
  render();
}
