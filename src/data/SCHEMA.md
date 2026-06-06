# Dataset schema

A dataset is one JSON file per game version at `src/data/<version>/recipes.json`,
generated from the game's `Docs.json` by `normalize.js` (via the in-browser
importer `tools/import.html`, or equivalently `node tools/gen-data.mjs <version>`).

Output is **deterministic**: keys are sorted and there are no timestamps, so the
same `Docs.json` + version always produces byte-identical output.

## Shape

```jsonc
{
  "gameVersion": "1.2",   // string tag for the source game version
  "schema": 1,            // bump if the shape below changes

  "items": {              // every craftable/raw item, keyed by class name
    "Desc_OreIron_C": { "name": "Iron Ore", "form": "solid" }
    // form: "solid" | "liquid" | "gas"
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
