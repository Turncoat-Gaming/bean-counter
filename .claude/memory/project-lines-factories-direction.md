---
name: project-lines-factories-direction
description: "Architecture decision — recipes stay per-item-per-line; divergence via multiple lines/factories, not per-step overrides. First step is the \"boundary cut\"."
metadata: 
  node_type: memory
  type: project
  originSessionId: 35a9d208-c21e-472f-b083-289e00dfe61f
---

Decided 2026-06-10 with the user. bean-counter will grow toward **factories
containing multiple production lines**, where one line's output can feed another
line's input (possibly across factories). A "line" is essentially today's plan
object (target recipe + rate + per-item `choices` + `recycle` toggles).

**Recipe choice stays per-item *within a line* — we will NOT add divergent
per-step (per-occurrence) recipe overrides.**
**Why:** the solver keys off item→one-recipe→one-level; that's what makes diamond
aggregation and the byproduct-crediting fixed-point clean (supply/demand balanced
per item, globally). Per-occurrence recipes force per-(item,branch) accounting,
make "which byproduct credits which demand" ambiguous, and would need fragile
tree-path-keyed bookmarks. Divergence is better expressed as two lines each with
their own per-item choice — which also matches how real factories diverge.
**How to apply:** when asked for "different recipe for this one step," steer to
splitting that sub-step into its own line, not a per-node recipe override.

**Boundary cut — SHIPPED 2026-06-10.** `solveChain` takes `opts.provided` (Set of
item keys); `expandRecipe()` makes provided items leaves; they surface in a new
`lineInputs` return bucket (net of byproduct credit, like raw). Tree nodes get
`provided` + `canProvide` flags; UI shows a 📦 toggle on each providable node and a
"Required inputs" section. Bookmark codec key `p` (providedItems). Verified on real
data (provide Iron Plate + Screws → Reinforced Iron Plate line declares its inputs,
14→2 machines).

**Multiple lines per doc — SHIPPED 2026-06-10.** A doc now holds many *lines*
(one factory), shown as a stacked accordion (tabs are reserved for *factories*
later). Each line is the old single-plan state and solves independently. New pure
`BC.solver.rollUpFactory(dataset, summaries)` nets the lines by item key: it sums
power/machines/byBuilding/raw and emits **line→line routes** (greedy producer
allocation in line order — deterministic; many producers/consumers resolve to
several routes, the cue to split a line), `outputs` (net>0, `product` flag if the
item is some line's target), and `unmet` (net<0, still external). UI builds a
normalized summary per line `{target,supplies,demands,raw,power,machines,byBuilding}`
(supplies = target + byproduct surplus; demands = 📦 `lineInputs`) for both chain
and single-step modes. Routing is **automatic by item** — no explicit edge UI yet.
Codec needed no change (the `entries[]` array already existed). Verified on real
1.2 data: RIP line @5/min with Iron Plate+Screws 📦, plus Iron Plate and Screws
lines → routes Iron Plate→RIP, Screws→RIP, no unmet, raw = Iron Ore only.

**Next increments (not built):** explicit per-edge link control (choose among
multiple producers, partial ratios); multiple *factories* with a tab switcher and
cross-factory feeds.

Builds on [[project-bean-counter]]; engine constraints in
[[feedback-no-npm-supply-chain]].
