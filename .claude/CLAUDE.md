# bean-counter — project directives

A personal, client-side **Satisfactory production planner**. Pure HTML + home-grown
ES modules. No backend, no secrets, no npm install to run it.

## Non-negotiables

- **Client-side only.** No server-side component, no backend calls, no build step
  required to run the app. The whole thing is static files served as-is.
- **No npm / no runtime dependencies by default.** Prefer zero third-party libs.
  If one is truly justified, it must be either vendored into the repo or pinned
  with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
  hashes from a CDN. Treat supply-chain risk as a first-class concern — assume
  any unpinned dependency is a liability.
- **No secrets.** Public repo; nothing here should ever require or contain one.
- **Deterministic.** Same input → same output, for both the calc engine and the
  data importer. Generated data files are byte-stable (sorted keys, no timestamps).
- **Node is dev-only.** `tools/gen-data.mjs` and the Node test runner are
  conveniences for maintainers, with zero dependencies. They are never part of
  the shipped app and there is no `package.json`.

## Architecture

- `src/engine/**` is **pure**: no DOM, no I/O beyond `fetch` for datasets. All
  math lives here and is unit-tested.
- `src/ui/**` owns the DOM and nothing else.
- `src/data/normalize.js` is the **single source of truth** for turning the
  game's `Docs.json` into our schema. Both `tools/import.html` (browser) and
  `tools/gen-data.mjs` (Node) call it — they must stay byte-equivalent.
- Datasets are **versioned**: `src/data/<gameVersion>/recipes.json`, indexed by
  `src/data/versions.json`. Schema is documented in `src/data/SCHEMA.md`.

## Workflow

- **Everything on `main`.** No feature branches, no PRs, no issues. Commit and
  push working content at natural stopping points.
- **Run/serve:** static server (e.g. `python3 -m http.server`) — ES modules don't
  load over `file://`. Tests: `node tests/engine.test.js` or open `tests/index.html`.
- **Memories** live in `.claude/memory/` and are committed with the repo as normal.

## Personas

Four lightweight roles guide focus (see `.claude/agents/`): **data-curator**
(dataset accuracy/schema), **solver-engineer** (the calc math), **frontend-ux**
(the UI), **docs-maintainer** (README/CLAUDE.md/memories). Keep everything compact
and single-responsibility — this is a small tool by design.
