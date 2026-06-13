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

  // Every manufacturable item you can actually make *from* a supply item — the
  // "what can I make from this?" list for supply-driven sizing. It must match the
  // solver: an item is only offered when some real production path for it draws
  // the supply, otherwise sizeFromSupplies finds nothing to bind to and the line
  // solves to zero (the bug this guards — bauxite once "reached" AI Limiters).
  //
  // So we mirror how the solver builds chains. `fed` is the supply plus every
  // intermediate whose *default producer* (the recipe the solver would build it
  // with) draws something already fed. We follow only that primary-product edge —
  // never a recipe's byproducts (a stray water/silica byproduct used to flood the
  // list) and never a resource-conversion output (the solver treats raws as leaves
  // and never builds toward them). An item is then offered when *some* recipe that
  // outputs it — in any slot, so an alternate root path or a byproduct target
  // counts — consumes a fed item. Excludes the source and raws; sorted by name;
  // cached per source.
  function reachableFrom(dataset, sourceItem) {
    if (!dataset.__reachable) Object.defineProperty(dataset, '__reachable', { value: new Map() });
    if (dataset.__reachable.has(sourceItem)) return dataset.__reachable.get(sourceItem);
    const cons = consumeIndex(dataset);
    const fed = new Set([sourceItem]); // the supply + intermediates whose default chain draws it
    const queue = [sourceItem];
    while (queue.length) {
      const item = queue.shift();
      for (const rk of cons[item] || []) {
        const product = dataset.recipes[rk].outputs[0].item;                     // primary product only
        if (fed.has(product)) continue;
        if (dataset.items[product] && dataset.items[product].resource) continue; // raws aren't built
        if (defaultRecipeKey(dataset, product) !== rk) continue;                 // only the solver's producer
        fed.add(product); queue.push(product);
      }
    }
    const list = manufacturableItems(dataset).filter((it) =>
      it !== sourceItem &&
      recipesOutputting(dataset, it).some((rk) =>
        dataset.recipes[rk].inputs.some((inp) => fed.has(inp.item))));
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

  // Apply the game's Advanced Game Settings global multipliers, returning a derived
  // dataset (the original is left untouched). These rescale the *math* but not the
  // structure — same items, recipes and reachability — so callers keep the static
  // pickers on the original dataset and only solve against this one.
  //   - `costMult` scales every recipe *input* amount (outputs are untouched).
  //     Solid parts round UP to a whole item (10 × 0.25 → ceil 2.5 → 3); fluids
  //     stay exact, since the game meters them continuously (Battery's 2.5 m³ acid
  //     × 0.25 → 0.625, not 1).
  //   - `powerMult` scales every building's power draw.
  // Identity (1×/1×) returns the original dataset, so the default path costs
  // nothing and keeps the structure caches warm.
  function applyModifiers(dataset, mods) {
    const costMult = (mods && mods.costMult) || 1;
    const powerMult = (mods && mods.powerMult) || 1;
    if (costMult === 1 && powerMult === 1) return dataset;
    const isFluid = (item) => {
      const it = dataset.items[item];
      return !!it && (it.form === 'liquid' || it.form === 'gas');
    };
    const scaleInput = (inp) => {
      if (costMult === 1) return inp;
      const scaled = inp.amount * costMult;
      const amount = isFluid(inp.item) ? scaled : Math.ceil(scaled - 1e-9);
      return amount === inp.amount ? inp : { item: inp.item, amount };
    };
    const recipes = {};
    for (const [k, r] of Object.entries(dataset.recipes)) {
      recipes[k] = costMult === 1 ? r : Object.assign({}, r, { inputs: r.inputs.map(scaleInput) });
    }
    const buildings = {};
    for (const [k, b] of Object.entries(dataset.buildings)) {
      buildings[k] = powerMult === 1 ? b : Object.assign({}, b, { power: b.power * powerMult });
    }
    return Object.assign({}, dataset, { recipes, buildings });
  }

  BC.data = {
    loadDataset, itemName, buildingName,
    pickerRecipes, variantsForRecipe, alternateCount, representativeKey,
    recipesForItem, defaultRecipeKey,
    manufacturableItems, recipesOutputting, defaultRecipeForItem,
    inputItems, reachableFrom, applyModifiers,
  };
  if (typeof module === 'object' && module.exports) module.exports = BC.data;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
