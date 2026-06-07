# bean-counter — project directives

A personal, client-side **Satisfactory production planner**. Pure HTML +
home-grown **classic scripts** (deliberately *not* ES modules, so it runs
straight from the filesystem). No backend, no secrets, nothing to install.

## Non-negotiables

- **Client-side only.** No server-side component, no backend calls, no build step
  required to run the app. The whole thing is static files.
- **Runs from `file://`.** Clone and double-click `index.html`. This is why we use
  classic `<script>` tags + a single `BeanCounter` global instead of ES modules,
  and load data via self-registering `recipes.js` scripts instead of `fetch()` —
  browsers block modules and `fetch()` over `file://`. Don't reintroduce either.
- **No npm / no runtime dependencies by default.** Prefer zero third-party libs.
  If one is truly justified, it must be vendored into the repo or pinned with
  [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
  hashes. Treat supply-chain risk as a first-class concern.
- **No secrets.** Public repo; nothing here should ever require or contain one.
- **Deterministic.** Same input → same output, for both the calc engine and the
  data importer. Generated data files are byte-stable (sorted keys, no timestamps).
- **Node is dev-only.** `tools/gen-data.js` and the Node test runner are
  conveniences for maintainers, with zero dependencies. They are never part of
  the shipped app and there is no `package.json`.

## Architecture

- Everything composes through one global, `BeanCounter` (`BeanCounter.calculator`,
  `.codec`, `.data`, `.ui`, `.datasets`, `.versions`). Each file is an IIFE that
  augments it.
- `src/engine/**` is **pure**: no DOM, no I/O. All math lives here and is tested.
- `src/ui/**` owns the DOM and nothing else.
- `src/data/normalize.js` is the **single source of truth** for turning the game's
  `Docs.json` into our schema (and serializing it to `recipes.js`). Both
  `tools/import.html` (browser) and `tools/gen-data.js` (Node) call it — they must
  stay byte-equivalent.
- Datasets are **versioned**: `src/data/<gameVersion>/recipes.js` (a self-
  registering script), listed in `src/data/versions.js`, and referenced from
  `index.html`. Schema is documented in `src/data/SCHEMA.md`.

## Security

Public, client-side, no backend or secrets — so the surface is small, but keep it that way:

- **Never `innerHTML` untrusted input** — anything from a bookmark/URL hash, a
  user-imported dataset, or `err.message`. Use `textContent`, or escape (see the
  `esc()` helper in `rate-calculator.js`). Bookmark links are attacker-controllable.
- **No inline scripts.** Every page sets a CSP `<meta>` with `script-src 'self'`
  and loads only external `<script src>` files. Don't add inline `<script>` or
  inline event handlers (`onclick=…`); use `addEventListener`. Keep `index.html`'s
  CSP strict (`default-src 'none'`).
- **No secrets, ever** — a public repo keeps them in history forever.
- Supply-chain hygiene (zero deps / SRI) is part of this too.

## Workflow

- **Everything on `main`.** No feature branches, no PRs, no issues. Commit and
  push working content at natural stopping points.
- **Run:** open `index.html` directly, or serve the folder anywhere (it's a plain
  static site — host on Pages, nginx, a NAS, etc.). Tests:
  `node tests/engine.test.js` or open `tests/index.html`.
- **Memories** live in `.claude/memory/` and are committed with the repo as normal.

## Personas

Four lightweight roles guide focus (see `.claude/agents/`): **data-curator**
(dataset accuracy/schema), **solver-engineer** (the calc math), **frontend-ux**
(the UI), **docs-maintainer** (README/CLAUDE.md/memories). Keep everything compact
and single-responsibility — this is a small tool by design.
