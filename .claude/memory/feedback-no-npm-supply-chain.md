---
name: feedback-no-npm-supply-chain
description: "Hard constraint for bean-counter — no npm/backend, zero runtime deps by default, supply-chain-conscious."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e685ed53-26f4-4109-ab07-b682c381019c
---

For [[project-bean-counter]] the user is emphatic: **no npm, no server-side
component**. Default to **zero runtime dependencies**. A third-party lib is only
acceptable if vendored into the repo or pinned with Subresource Integrity (SRI)
hashes from a CDN — and even then, only when clearly justified.

**Why:** they explicitly want to avoid any possibility of supply-chain attacks,
and consider this "not that complicated" a tool to need a dependency stack. No
secrets — public repo.

**How to apply:** reach for built-in browser/JS APIs first (`TextDecoder`,
`btoa`, `fetch`, etc.). No external fonts/CSS/JS from CDNs. A minify/compile step
is allowed but optional. Node is dev-only (zero-dep scripts like
`tools/gen-data.mjs`), never shipped, no `package.json`.
