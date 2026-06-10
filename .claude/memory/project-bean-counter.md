---
name: project-bean-counter
description: What bean-counter is — a personal client-side Satisfactory production planner — its MVP and roadmap.
metadata: 
  node_type: memory
  type: project
  originSessionId: e685ed53-26f4-4109-ab07-b682c381019c
---

**bean-counter** (repo: Turncoat-Gaming/bean-counter) is the user's personal
Satisfactory production planner. Many planners exist; this is their own take.

Pure client-side HTML, no backend. Deliberately uses **classic `<script>` tags +
a single `BeanCounter` global (NOT ES modules)** and self-registering
`recipes.js` data scripts (NOT `fetch`/JSON) so it **runs straight from the
filesystem — clone and double-click `index.html`**. The user explicitly wanted
clone-and-run with zero tooling; that's why ES modules were dropped. Also a plain
static site, so it can be hosted anywhere (their own NAS/kube/CI-CD). Architecture:
pure `src/engine/**` (math, tested), thin `src/ui/**` (DOM), versioned datasets at
`src/data/<version>/recipes.js` generated from the game's `Docs.json` by the
shared `src/data/normalize.js`.

Shipped so far: **single-step rate calculator**; **bookmark save/load**
(reversible base64url plan string mirrored to the URL hash — encoding, not
hashing); **alternate-recipe handling** (picker hides alternates, grouped by
primary product, with a variant chip selector); and a **full-chain solver**
(`src/engine/solver.js`) — target → whole chain to raw resources, machines/power
per step, raw-resource + byproduct totals, per-building roll-up. Solver uses
memoized per-unit expansion so shared intermediates aggregate; raw resources are
flagged `resource:true` in data (they have conversion/unpackage recipes, so the
flag is what stops the solver "producing" them). Solver takes an optional
`recipeChoices` (item→recipeKey) override map. **Per-step alternate selection**:
each chain step with alternates shows an inline `<select>`; picks feed
`recipeChoices` and persist in the bookmark as `c:[recipeKey…]` (item derived from
the recipe's product). Choice is **per item** (one recipe per item globally) so
totals stay coherent. The chain view shows an **indented production tree** (solver
returns a literal `tree`; nested `<ul>` for indentation; shared intermediates
duplicated with per-branch sub-rates) with the per-node selectors, plus a
read-only aggregated **Totals** table below.

**Byproduct crediting** (shipped 2026-06-10): the aggregate solve was rewritten
from the old memoized per-unit walk to a **fixed-point (Jacobi) iteration over
per-item production levels** (`net demand = target+consumption − credited
byproduct`, floored at 0; cap 1000 iters with a non-convergence warning), because
crediting couples the whole system (water loops, HOR↔plastic/rubber) and isn't
tree-decomposable. Crediting is **opt-in per item** via `opts.recycle` (Set of
item keys); the tree stays a gross-flow view while Totals reflect credits. Solver
output: `steps`/`raw` rows carry `recyclable` (a byproduct source exists) +
`recycling`; `byproducts` entries are now `{item, gross, credited, surplus, form,
fluid, recyclable, recycling}`. UI puts a **♻ reuse** checkbox on each recyclable
**production-tree node** (solver annotates `tree` nodes with recyclable/recycling,
like the per-node recipe selector; per-item so duplicated occurrences share state);
the Byproducts panel highlights surplus, fluids (form≠solid) flagged hard.
Persisted in the bookmark as `y:[itemKeys]` (codec).

Roadmap (evolve simply): overclock, multi-line plans, version selector growth.

Constraints live in [[feedback-no-npm-supply-chain]]; workflow in
[[project-workflow-main-only]].
