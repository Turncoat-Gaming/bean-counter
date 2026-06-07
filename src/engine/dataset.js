// dataset.js — dataset registry and queries. Classic script on the `BeanCounter`
// global (loads over file://). No fetch(): datasets register themselves by
// loading their own `recipes.js` via a <script> tag, which works from the
// filesystem where fetch() does not. Also CommonJS-exports the pure query
// helpers for the Node test runner.
(function (BC) {
  'use strict';

  // recipes.js files do: BeanCounter.datasets["<ver>"] = { ...dataset }.
  BC.datasets = BC.datasets || {};

  // Resolve a registered dataset; if it isn't loaded yet, inject its script and
  // wait. (Today every version is preloaded in index.html, so this resolves
  // synchronously — the injection path is here for when versions multiply.)
  function loadDataset(version) {
    if (BC.datasets[version]) return Promise.resolve(BC.datasets[version]);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'src/data/' + version + '/recipes.js';
      s.onload = () => {
        if (BC.datasets[version]) resolve(BC.datasets[version]);
        else reject(new Error('dataset ' + version + ' did not register'));
      };
      s.onerror = () => reject(new Error('could not load dataset ' + version));
      document.head.appendChild(s);
    });
  }

  function itemName(dataset, itemKey) {
    return (dataset.items[itemKey] && dataset.items[itemKey].name) || itemKey;
  }

  function buildingName(dataset, buildingKey) {
    return (dataset.buildings[buildingKey] && dataset.buildings[buildingKey].name) || buildingKey;
  }

  // --- alternate-recipe grouping ---------------------------------------------
  //
  // Recipes are grouped by their primary product (outputs[0]). For each product
  // group: standard recipes come first, then alternates, each sorted by name.
  // The picker shows standard recipes (plus, for products that have *only*
  // alternates, those alternates so nothing becomes unreachable); the rest are
  // offered as selectable variants once a recipe is chosen.

  // Lazily computed, cached non-enumerably so it never leaks into serialization.
  function productIndex(dataset) {
    if (!dataset.__productIndex) {
      const idx = {};
      for (const [key, r] of Object.entries(dataset.recipes)) {
        const product = r.outputs[0].item;
        (idx[product] = idx[product] || []).push(key);
      }
      for (const product of Object.keys(idx)) {
        idx[product].sort((a, b) => {
          const ra = dataset.recipes[a], rb = dataset.recipes[b];
          if (!!ra.alternate !== !!rb.alternate) return ra.alternate ? 1 : -1;
          return ra.name.localeCompare(rb.name);
        });
      }
      Object.defineProperty(dataset, '__productIndex', { value: idx });
    }
    return dataset.__productIndex;
  }

  function pickerKeySet(dataset) {
    if (!dataset.__pickerKeys) {
      const idx = productIndex(dataset);
      const set = new Set();
      for (const product of Object.keys(idx)) {
        const group = idx[product];
        const standards = group.filter((k) => !dataset.recipes[k].alternate);
        (standards.length ? standards : group).forEach((k) => set.add(k));
      }
      Object.defineProperty(dataset, '__pickerKeys', { value: set });
    }
    return dataset.__pickerKeys;
  }

  // Recipes for the main picker (alternates suppressed), [key, recipe] by name.
  function pickerRecipes(dataset) {
    const set = pickerKeySet(dataset);
    return Object.entries(dataset.recipes)
      .filter(([k]) => set.has(k))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  }

  // All recipe keys whose primary product is `itemKey` (standard first).
  function recipesForItem(dataset, itemKey) {
    return productIndex(dataset)[itemKey] || [];
  }

  // The default recipe to produce an item: its first standard recipe (or first
  // alternate if that's all there is), else null. Callers handle raw resources.
  function defaultRecipeKey(dataset, itemKey) {
    const group = recipesForItem(dataset, itemKey);
    return group.length ? group[0] : null;
  }

  // All recipe keys that produce the same primary product as `recipeKey`
  // (standard first, then alternates) — i.e. its selectable variants.
  function variantsForRecipe(dataset, recipeKey) {
    const r = dataset.recipes[recipeKey];
    if (!r) return [recipeKey];
    return recipesForItem(dataset, r.outputs[0].item) || [recipeKey];
  }

  // How many of a recipe's variants are alternates (for the indicator).
  function alternateCount(dataset, recipeKey) {
    return variantsForRecipe(dataset, recipeKey).filter((k) => dataset.recipes[k].alternate).length;
  }

  // The picker (dropdown) entry that represents a recipe's group — itself if it's
  // a picker entry, otherwise the group's standard recipe. Keeps the dropdown in
  // sync when an alternate is active or restored from a bookmark.
  function representativeKey(dataset, recipeKey) {
    const set = pickerKeySet(dataset);
    if (set.has(recipeKey)) return recipeKey;
    const group = variantsForRecipe(dataset, recipeKey);
    return group.find((k) => set.has(k)) || recipeKey;
  }

  BC.data = {
    loadDataset, itemName, buildingName,
    pickerRecipes, variantsForRecipe, alternateCount, representativeKey,
    recipesForItem, defaultRecipeKey,
  };
  if (typeof module === 'object' && module.exports) module.exports = BC.data;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
