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

MVP shipped first cut: **rate calculator** (recipe + target rate → machines,
inputs, byproducts, power) and **bookmark save/load** (reversible base64url plan
string mirrored to the URL hash — encoding, not hashing).

Roadmap (evolve simply): full production-chain solver, power/resource roll-ups,
alternate-recipe selection, multi-line plans, version selector growth.

Constraints live in [[feedback-no-npm-supply-chain]]; workflow in
[[project-workflow-main-only]].
