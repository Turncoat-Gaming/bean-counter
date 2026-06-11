# Dataset schema

A dataset is one file per game version at `src/data/<version>/recipes.js`,
generated from the game's `Docs.json` by `normalize.js` (via the in-browser
importer `tools/import.html`, or equivalently `node tools/gen-data.js <version>`).

The file is a thin classic-script wrapper that registers the dataset on the
global so it loads over `file://`:

```js
(function (BC) {
  BC.datasets = BC.datasets || {};
  BC.datasets["1.2"] = { /* the object below */ };
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
```

Output is **deterministic**: keys are sorted and there are no timestamps, so the
same `Docs.json` + version always produces byte-identical output.

## Shape (the registered object)

```jsonc
{
  "gameVersion": "1.2",   // string tag for the source game version
  "schema": 3,            // bump if the shape below changes

  "items": {              // every craftable/raw item, keyed by class name
    "Desc_OreIron_C": { "name": "Iron Ore", "form": "solid", "resource": true }
    // form: "solid" | "liquid" | "gas"
    // resource: true only for raw/extractable resources (the chain's leaves).
    //   Omitted otherwise. Many resources also have conversion/unpackage
    //   recipes, so the solver relies on this flag to treat them as raw.
  },

  "buildings": {          // production machines, keyed by class name
    "Build_SmelterMk1_C": { "name": "Smelter", "power": 4 }
    // power: base draw in MW at 100% clock
  },

  "recipes": {            // only recipes automatable in a `buildings` machine
    "Recipe_IngotIron_C": {
      "name": "Iron Ingot",
      "time": 2,                 // seconds per craft at 100% clock
      "building": "Build_SmelterMk1_C",
      "alternate": false,        // true for the game's "Alternate: …" recipes
      "inputs":  [ { "item": "Desc_OreIron_C",  "amount": 1 } ],
      "outputs": [ { "item": "Desc_IronIngot_C", "amount": 1 } ]
      // amount = units per craft; outputs[0] is the primary product.
      // Fluid amounts are in m³ (the importer divides the raw ×1000 values down).
    }
  }
}
```

## Conventions

- **Class names are keys.** `Desc_*_C` for items, `Build_*_C` for buildings,
  `Recipe_*_C` for recipes — exactly as they appear in `Docs.json`.
- **Per-minute rates are derived, not stored:** `amount * 60 / time`.
- **Excluded:** build-gun/construction recipes, manual workbench-only crafts, and
  customizer recipes. A recipe is kept only if `mProducedIn` lists a machine that
  exists in `buildings`.
- **Raw resources** (mined/extracted) appear as items but have no recipe; they're
  the leaves of any production chain.
- **Alternates** are flagged with `"alternate": true`. The main picker lists
  *items* (every recipe output that isn't a raw resource — products and
  byproducts alike); which recipe makes the chosen item is picked on the
  production tree's root node, where standard recipes lead and alternates follow.
  An item with no recipe of its own (a pure byproduct, e.g. Dissolved Silica) is
  still targetable — `defaultRecipeForItem` falls back to a recipe that yields it
  as a byproduct, and the chain scales to that output slot.
