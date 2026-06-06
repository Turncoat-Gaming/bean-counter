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

Pure client-side HTML + home-grown ES modules, no backend, runnable by serving
the folder statically (ES modules don't load over `file://`; GitHub Pages is the
hosted path). Architecture: pure `src/engine/**` (math, tested), thin `src/ui/**`
(DOM), versioned datasets at `src/data/<version>/recipes.json` generated from the
game's `Docs.json` by the shared `src/data/normalize.js`.

MVP shipped first cut: **rate calculator** (recipe + target rate → machines,
inputs, byproducts, power) and **bookmark save/load** (reversible base64url plan
string mirrored to the URL hash — encoding, not hashing).

Roadmap (evolve simply): full production-chain solver, power/resource roll-ups,
alternate-recipe selection, multi-line plans, version selector growth.

Constraints live in [[feedback-no-npm-supply-chain]]; workflow in
[[project-workflow-main-only]].
