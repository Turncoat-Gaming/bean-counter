---
name: project-game-mode-multipliers
description: "Global Advanced Game Settings multipliers — recipe parts cost (0.25–2×, solids ceil / fluids exact) and machine power (0.25,0.5,0.75,1,2,5×) — via a derived dataset, two top-bar dropdowns, plan-level bookmark keys."
metadata:
  type: project
---

Decided + built 2026-06-13 with the user (falken224). Models Satisfactory's
**Advanced Game Settings** two global multipliers (NOT Somersloops — I first
mis-read "cost multiplier" as production amplification; the user corrected: it's
the game-mode-wide settings):

- **Recipe parts cost multiplier** — scales every recipe's *input* amounts
  (outputs untouched). Range **0.25–2 in 0.25 steps**. **Solids round UP to a
  whole item** (`10 × 0.25 = 2.5 → ceil → 3`); **fluids stay exact** (continuous —
  the game meters fluids by 1/1000 m³, and Battery's 2.5 m³ acid is already
  fractional at 1×, so blanket-ceiling would corrupt the base recipe). The user
  initially said "fluids round up to 1/1000" then corrected to **exact fractional**.
- **Power consumption multiplier** — scales every building's power. Values
  **{0.25, 0.5, 0.75, 1, 2, 5}**.

**Key implementation choice — a derived dataset, not threaded params.** The
multipliers rescale the *math* but not the *structure* (same items/recipes/
reachability). So `BC.data.applyModifiers(dataset, {costMult, powerMult})`
(dataset.js, pure, tested) returns a derived dataset with scaled input amounts +
scaled building power; **identity at 1×/1× returns the original** (fast path, keeps
structure caches warm). The UI keeps all static pickers/reachability on the
original `dataset` and solves against `solveDataset = applyModifiers(dataset,
mods)`, rebuilt only when a dropdown changes. Because both drivers ("Make an
item" / "From a supply") and the factory roll-up all funnel through
`solveChain`/`sizeFromSupplies`/`computeRecipePlan`, swapping the dataset there
was the whole engine change — "both sides" for free. `rollUpFactory` stays on the
original dataset (it only reads labels; the numbers come from per-line summaries
already solved against `solveDataset`).

**UI (`rate-calculator.js` + `index.html`):** two `<select>`s in the top bar,
grouped in `.topbar .settings` (right-aligned, wraps). `mods`/`solveDataset`/
`applyMods()` state near the top of `mountPlanner`; `onModChange` reads the selects
→ rebuild. Handlers attached via **`sel.onchange =` (assignment, not
addEventListener)** so a version-change re-mount never stacks them (the selects
live in the header, outside `#app`).

**Bookmark:** plan-level (not per-line) codec keys **`m`** (cost) and **`w`**
(power), **omitted at default 1×** so every existing bookmark decodes unchanged
(decode defaults both to 1). TAG stays `bc1.`. `encodePlan`/`decodePlan` gained
`costMult`/`powerMult` on the plan object; `updateBookmark` passes `mods`,
`restoreFromHash` sets `mods` + syncs the selects + `applyMods()` **before**
building entries (so supply-line sizing uses the scaled dataset).

**Verified:** 46 engine tests pass (`node tests/engine.test.js`, was 42 — added
applyModifiers rounding/power/identity, a cost-scaled solve, a power-scaled solve,
codec round-trip). **NOT yet click-tested in-browser by the user** (no headless
browser here; file:// app). Watch on click-test: dropdowns populate + default to
×1; changing them re-solves all lines + factory; numbers move the right way (×2
cost → ~2× raw, fewer/normal machines; ×5 power → 5× MW); bookmark round-trips a
non-default setting and old bookmarks still load at 1×.

Builds on [[project-supply-driven-sizing]] and [[project-item-based-picker]].
Overclock/clock-speed is still a separate roadmap item (composes multiplicatively
with these, no conflict).
