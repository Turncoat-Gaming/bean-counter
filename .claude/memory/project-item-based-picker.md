---
name: project-item-based-picker
description: "Main dropdown picks an item to make (products + byproducts); the recipe is chosen on the tree's root node. Byproducts are fully targetable via a slot-aware solver. SHIPPED."
metadata: 
  node_type: memory
  type: project
  originSessionId: cd39570a-516f-453a-8f3f-4ca57a4a3b99
---

Decided + SHIPPED 2026-06-11 with the user. The main planner dropdown used to be
a **recipe** picker (one representative recipe per product, alternates suppressed,
plus chips under the dropdown). It is now an **item** picker: it lists every
*manufacturable item* — anything that appears as a recipe output and isn't a raw
resource, **products and byproducts alike**. After picking the item, the recipe
(incl. alternates and byproduct sources) is chosen on the **production tree's root
node**. The old variant **chips were removed** (recipe selection lives only on
tree nodes now).

**Byproducts are fully targetable** (user's explicit call). Picking a byproduct +
rate scales its host recipe and inputs to produce that much of it; the host's
primary output surfaces as line **surplus**. This works because the solver was
already slot-aware via `outputFor(recipe, item)` — the only change was the entry
point.

**How it's wired (files):**
- `src/engine/dataset.js`: new `manufacturableItems(ds)` (sorted output items,
  minus resources), `recipesOutputting(ds, item)` (all recipes outputting it, any
  slot, standard-first — drives the **target node's** recipe `<select>`), and
  `defaultRecipeForItem(ds, item)` (primary recipe if any, else first byproduct
  source). `defaultRecipeKey` stays primary-only for **intermediates**.
- `src/engine/solver.js`: `solveChain(ds, targetItem, targetRate, opts)` — was
  `targetRecipeKey`. Root recipe = `opts.recipeChoices[targetItem]` or
  `defaultRecipeForItem`. Sets `tree.isTarget = true` on the root node.
- `src/engine/calculator.js`: `computeRecipePlan(ds, recipeKey, rate, targetItem?)`
  scales by the target output slot; `byproducts` = the other outputs.
- `src/ui/rate-calculator.js`: line state holds `targetItem` (the root recipe lives
  in the existing `choices[targetItem]`, no new field). Dropdown class `.target-item`.
  `recipeCell` uses `recipesOutputting` for the `isTarget` node, `recipesForItem`
  otherwise. Removed `renderVariants`/`setActive`/chips and the `.variants` CSS.
- `src/engine/plan-codec.js`: wire entry gained `i` = targetItem; `r` is now the
  **optional** root recipe (stored only when non-default). **Back-compat:** old
  bookmarks carry only `r`; the UI (`entryToLine`) derives the item from
  `recipes[r].outputs[0].item`. TAG stays `bc1.` (additive).

**Packaging-cycle handling (fixed in follow-up same day).** Two bugs surfaced when
targeting Heavy Oil Residue: (1) the tree crashed — `treeNode` rendered `cycle`/
`truncated` nodes (which carry no `machines`/`buildingName`) through the "built
here" branch → `fmt(undefined)`. Now `treeNode` renders them as leaves (`cycle` tag
in `--error`, `…` for truncated). This was a latent pre-existing bug. (2) the
*default* recipe for HOR was `Recipe_UnpackageOilResidue_C` (a standard recipe whose
input Packaged Oil Residue is made from HOR → 2-step loop, 3751 machines).
`defaultRecipeForItem` now skips candidates whose default sub-chain loops back to the
item (`loopsBackTo`, a bounded DFS), so HOR → the real "Heavy Oil Residue" recipe
(1.5 machines, no warning). Verified across all 142 real 1.2 items: 0 crash-prone
tree nodes; cyclic-default items dropped from ~many to 15 edge cases (explosives,
packaged fuels) that genuinely loop through intermediates — non-fatal (truncated +
shown), and switchable via the tree root node.

Builds on [[project-bean-counter]] and [[project-lines-factories-direction]].
