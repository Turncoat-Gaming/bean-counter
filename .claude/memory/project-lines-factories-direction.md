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

**Next increments (not built):** multiple lines per doc, each solved independently;
route one line's output to satisfy another's `lineInputs`; factory-wide roll-up
(sum raw/power/byproducts); then factories grouping lines.

Builds on [[project-bean-counter]]; engine constraints in
[[feedback-no-npm-supply-chain]].
