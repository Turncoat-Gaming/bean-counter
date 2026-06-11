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

  // Index every item that appears as *any* output (primary or byproduct) to the
  // recipe keys producing it, standard-first then by name. Powers the item picker
  // and the target node's recipe choices (which include byproduct sources).
  function outputIndex(dataset) {
    if (!dataset.__outputIndex) {
      const idx = {};
      for (const [key, r] of Object.entries(dataset.recipes)) {
        for (const o of r.outputs) (idx[o.item] = idx[o.item] || new Set()).add(key);
      }
      const byKey = {};
      for (const item of Object.keys(idx)) {
        byKey[item] = [...idx[item]].sort((a, b) => {
          const ra = dataset.recipes[a], rb = dataset.recipes[b];
          if (!!ra.alternate !== !!rb.alternate) return ra.alternate ? 1 : -1;
          return ra.name.localeCompare(rb.name);
        });
      }
      Object.defineProperty(dataset, '__outputIndex', { value: byKey });
    }
    return dataset.__outputIndex;
  }

  // All recipe keys that output `itemKey` in any slot (standard first). Broader
  // than recipesForItem — includes recipes where it's a byproduct.
  function recipesOutputting(dataset, itemKey) {
    return outputIndex(dataset)[itemKey] || [];
  }

  // Every item that can be made (appears as some recipe output) and isn't a raw
  // resource — the main picker's option list, sorted by display name.
  function manufacturableItems(dataset) {
    if (!dataset.__manufacturable) {
      const items = Object.keys(outputIndex(dataset))
        .filter((it) => !(dataset.items[it] && dataset.items[it].resource))
        .sort((a, b) => itemName(dataset, a).localeCompare(itemName(dataset, b)));
      Object.defineProperty(dataset, '__manufacturable', { value: items });
    }
    return dataset.__manufacturable;
  }

  // Index every item consumed by some recipe -> the recipe keys consuming it. The
  // forward (output->next-recipe) counterpart of outputIndex; powers reachability.
  function consumeIndex(dataset) {
    if (!dataset.__consumeIndex) {
      const idx = {};
      for (const [key, r] of Object.entries(dataset.recipes)) {
        for (const inp of r.inputs) (idx[inp.item] = idx[inp.item] || new Set()).add(key);
      }
      Object.defineProperty(dataset, '__consumeIndex', { value: idx });
    }
    return dataset.__consumeIndex;
  }

  // Every item that's consumed by some recipe — the things you can usefully name as
  // a *supply* to make something from. Sorted by display name. Includes raws.
  function inputItems(dataset) {
    if (!dataset.__inputItems) {
      const items = Object.keys(consumeIndex(dataset))
        .sort((a, b) => itemName(dataset, a).localeCompare(itemName(dataset, b)));
      Object.defineProperty(dataset, '__inputItems', { value: items });
    }
    return dataset.__inputItems;
  }

  // Every manufacturable item reachable *forward* from a supply item — i.e. anything
  // you can produce along some path that consumes it (its consumers' outputs, and
  // theirs, transitively). Excludes the source itself and raw resources; sorted by
  // display name. Cached per source. Drives the "what can I make from this?" list.
  function reachableFrom(dataset, sourceItem) {
    if (!dataset.__reachable) Object.defineProperty(dataset, '__reachable', { value: new Map() });
    if (dataset.__reachable.has(sourceItem)) return dataset.__reachable.get(sourceItem);
    const cons = consumeIndex(dataset);
    const reached = new Set();   // items produced downstream of the source
    const visited = new Set();   // items whose consumers we've already expanded
    const queue = [sourceItem];
    while (queue.length) {
      const item = queue.shift();
      if (visited.has(item)) continue;
      visited.add(item);
      for (const rk of cons[item] || []) {
        for (const o of dataset.recipes[rk].outputs) {
          if (!reached.has(o.item)) { reached.add(o.item); queue.push(o.item); }
        }
      }
    }
    reached.delete(sourceItem);
    const list = [...reached]
      .filter((it) => !(dataset.items[it] && dataset.items[it].resource))
      .sort((a, b) => itemName(dataset, a).localeCompare(itemName(dataset, b)));
    dataset.__reachable.set(sourceItem, list);
    return list;
  }

  // The default recipe to produce an item: its first standard recipe (or first
  // alternate if that's all there is), else null. Callers handle raw resources.
  function defaultRecipeKey(dataset, itemKey) {
    const group = recipesForItem(dataset, itemKey);
    return group.length ? group[0] : null;
  }

  // Does making `targetItem` via `recipeKey` loop back to `targetItem` through the
  // default sub-recipes of its inputs? Bounded DFS; a shared `seen` set keeps it
  // cheap and terminates on the cyclic data it's meant to detect. Used to skip
  // packaging/unpackaging recipes (e.g. Unpackage Oil Residue ⇄ Package) when
  // picking a sane default producer.
  function loopsBackTo(dataset, recipeKey, targetItem) {
    const seen = new Set();
    function reaches(item, depth) {
      if (item === targetItem) return true;
      if (depth > 40 || seen.has(item)) return false;
      seen.add(item);
      const rk = defaultRecipeKey(dataset, item); // primary-only producer for intermediates
      if (!rk) return false;                       // raw / no producer — a leaf
      return dataset.recipes[rk].inputs.some((inp) => reaches(inp.item, depth + 1));
    }
    return dataset.recipes[recipeKey].inputs.some((inp) => reaches(inp.item, 0));
  }

  // The default recipe when an item is a *target*: its primary recipes first, then
  // recipes that make it as a byproduct. Prefer the first candidate whose default
  // sub-chain doesn't loop back to the item — so a byproduct/fluid target lands on
  // a real producer (e.g. the Heavy Oil Residue recipe) rather than its unpackage
  // recipe, which cycles. Falls back to the first candidate if every one loops.
  // null only for raw items (nothing produces them).
  function defaultRecipeForItem(dataset, itemKey) {
    const primary = recipesForItem(dataset, itemKey);
    const extra = recipesOutputting(dataset, itemKey).filter((k) => !primary.includes(k));
    const candidates = primary.concat(extra);
    if (!candidates.length) return null;
    return candidates.find((k) => !loopsBackTo(dataset, k, itemKey)) || candidates[0];
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
    manufacturableItems, recipesOutputting, defaultRecipeForItem,
    inputItems, reachableFrom,
  };
  if (typeof module === 'object' && module.exports) module.exports = BC.data;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
