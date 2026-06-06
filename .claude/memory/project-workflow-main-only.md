---
name: project-workflow-main-only
description: "bean-counter git workflow — everything on main, commit+push at stopping points, no branches/PRs/issues."
metadata: 
  node_type: memory
  type: project
  originSessionId: e685ed53-26f4-4109-ab07-b682c381019c
---

[[project-bean-counter]] uses a deliberately flat workflow: **everything on
`main`**. No feature branches, no pull requests, no issues. Commit and push all
working content at natural stopping points.

Remote is SSH (`git@github.com:Turncoat-Gaming/bean-counter.git`); in the sandbox
a push may need the user to run it (e.g. via a `!` command) if network/SSH is
restricted.

Memories live in `.claude/memory/` and are committed with the repo like any other
content. `.claudebox` (sandbox metadata) is gitignored.
