---
name: project-supply-driven-sizing
description: "Per-line 'From a supply' driver: size an end product's output from a fixed input supply, pick the path on the tree (per-path yield hints). Primary-only constraint for now; first cut, UI expected to iterate."
metadata: 
  node_type: memory
  type: project
  originSessionId: cd39570a-516f-453a-8f3f-4ca57a4a3b99
---

Decided + built 2026-06-11 with the user (falken224). A planner line can now be
driven two ways, chosen by a per-line toggle (`line.driver`): the existing
**'Make an item'** (target output rate) or the new **'From a supply'**. Supply
mode: pick a *source* item + how much you have, the **Make** dropdown lists only
items **reachable forward** from that source, and choosing one **sizes the output**
to whatever the supply yields. You still pick the *path* (alt recipe) on the tree's
root node; the root recipe `<select>` shows each path's **yield from the supply**
inline (e.g. `Residual Fuel — 26.67/min`, `Diluted Fuel — 80/min`) so you can
optimize by comparison. The user optimizes; the tool does **not** auto-pick the max.

**The key insight that makes it cheap:** this is the existing *backward* solver with
the supply marked as the chain **boundary**. A supply is `provided` (the existing
📦 line-input mechanism) so the solver stops there instead of manufacturing it —
otherwise a supply that has its own recipe (Heavy Oil Residue from Crude Oil) gets
expanded away and draws *nothing of what you hold*. Then: solve at unit output,
read the supply's draw from `lineInputs`, set output = `supply ÷ draw` (the binding
constraint). Linear, no new math, no LP.

**Engine (pure, tested):**
- `dataset.js`: `consumeIndex` (item→consuming recipes), `inputItems(ds)` (everything
  consumed, incl. raws — the supply picker list), `reachableFrom(ds, source)`
  (the Make list, cached per source). **Solver-aligned (fixed 2026-06-13):** it is
  NOT a naive forward BFS — that leaked through byproducts and resource-conversion
  outputs, offering items the chain can't actually draw the supply for (bauxite →
  "AI Limiters", which solve to 0). Now it builds `fed` = supply + intermediates
  whose *default producer* draws something fed (primary-product edges only, raws
  skipped — mirrors how the solver expands), then offers a manufacturable item iff
  *some* recipe outputting it (any slot, so alt root paths / byproduct targets
  count) consumes a fed item. Every offered item therefore has a real binding path,
  so `ensureBoundPath` always finds one.
- `solver.js`: `sizeFromSupplies(ds, target, supplies, opts)` where `supplies` is
  `[{item,rate}]`. Marks each supply `provided`, solves at unit, output =
  `min(rate÷draw)` across supplies; argmin is `sizing.binding`; non-binding report
  `slack`. Draws **none** → `sizing.unbound` (rate 0), so the UI explains instead of
  showing ∞. **Plural on purpose:** UI passes one (the primary) for now, but
  secondary constrained supplies can be added later without reshaping callers — the
  user explicitly wants that left open (don't box us in) but **not built yet**;
  they want to use the single-supply UI first before designing multi-constraint.

**UI (`rate-calculator.js`):** `line` gains `driver`/`sourceItem`/`supplyRate`.
`renderChain` branches on driver; supply mode derives `targetRate` from the sizing.
`ensureBoundPath(line)` lands a supply line on the first path that actually consumes
the source (standard-first — **not** yield-max), so the default view isn't a dead
"unbound" (Fuel's default recipe is from Crude Oil and ignores HOR). `sourceDraw`
helper backs both the hints and ensureBoundPath. A `⟲ N/min in factory [use]` chip
appears when other lines surplus the chosen source (pulls the amount in) — this is
the "incorporates both" answer: the supply field is **always** a free hypothetical
number, never *constrained* to factory surplus; the chip is just a one-click prefill.

**Bookmark:** additive — wire keys `d`(driver) `s`(source) `u`(supplyRate); `i/r/c/y/p`
unchanged; target rate re-derived on restore. Old bookmarks still decode (driver
defaults 'rate'). TAG stays `bc1.`.

**Deferred (user's call, long-term):** splitting one supply across two end products
(manual for now); multiple constrained supplies (secondary resources capping output).
Verified: 40 HOR → Residual Fuel = 26.67 Fuel/min on real 1.2 data; 41 engine tests
pass. Builds on [[project-item-based-picker]] and [[project-lines-factories-direction]].

---

**STATE @ 2026-06-11 EOD (committed, NOT yet validated in-browser by user).** Engine +
UI + codec + CSS + tests all written and green (`node tests/engine.test.js` = 41).
Node smoke test confirms the HOR→Fuel math. The user wrapped up before clicking
through the actual UI, so the DOM/interaction layer is unproven by hand.

**Pieces to solve tomorrow (in rough order):**
1. **Click-test the UI from `file://`** — first thing. Confirm: driver toggle swaps
   the form; Supply→Make list filters; sized "→ N/min" readout updates live; the
   root-node recipe `<select>` shows per-path yields; switching path resizes; the
   source renders as the 📦 fully-consumed input; bookmark round-trips a supply line.
   Watch for any `fmt(undefined)`-style crashes like the item-picker rollout had.
2. **Decide the default-path behavior** (open question, user wants to react): right
   now `ensureBoundPath` auto-lands on the first *standard* recipe that consumes the
   supply (Residual Fuel), not the item default and not the max-yield. Confirm that's
   the right feel vs. leaving it on the item default and just showing the "n/a /
   doesn't use …" state until they pick.
3. **Decide yield-hint placement** — currently inline in the root `<select>` option
   labels. User said it's helpful "even if it gets tweaked." May want a more
   glanceable comparison (e.g. a small ranked list) instead of/in addition to the
   dropdown.
4. **Perf sanity** — `renderChain` (supply mode) + `ensureBoundPath` each solve once
   per `recipesOutputting(target)`; fine for Fuel (~4) but check an item that's an
   output of many recipes; memoize per-(target,source,recipe) draw if it bites.
5. **Polish the 📦 on the source node** — toggling it off bounces back (sizeFromSupplies
   re-provides). Consider hiding/locking the toggle on the supply node in supply mode.
6. Then (later, not tomorrow unless asked): the two deferred items above
   (multi-supply constraints; split one supply across two products).
