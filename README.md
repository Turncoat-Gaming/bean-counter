# bean-counter

A personal [Satisfactory](https://www.satisfactorygame.com/) production planner.
Plenty of great planners exist — this one is mine. It runs **entirely in your
browser** with **no backend, no accounts, no build step, and no npm**. Same
input, same results, anywhere.

## Run it

**Clone the repo and open `index.html` — double-click it.** That's it. It works
straight from the filesystem, offline. No server, no tooling.

```sh
git clone https://github.com/Turncoat-Gaming/bean-counter.git
# then open bean-counter/index.html in your browser
```

It's also a plain static site, so you can host it anywhere (GitHub Pages, an
nginx box, a NAS share) by serving the files as-is.

> It uses classic `<script>` tags and script-loaded data specifically so it runs
> over `file://` — no ES modules or `fetch()`, which browsers block from the
> filesystem.

## What it does (today)

- **Full-chain solver** — pick a target item + rate and get the whole production
  chain down to raw resources. You get an **indented production tree** (so you can
  see where each branch's demand goes — e.g. screws for the plate vs. screws for
  the frame), plus an **aggregated totals table**, raw-resource draw,
  byproducts, and a per-building roll-up. Tree nodes are collapsible. (Toggle to
  **Single step** for just the one recipe.)
- **Byproduct crediting** — any node in the production tree whose item also comes
  out of another recipe as a byproduct gets a **♻ reuse** toggle. Tick it and that
  byproduct is credited against demand, cutting machines and raw draw; leftover
  **surplus** is called out
  (fluids/gases flagged hard, since they can't go to the AWESOME Sink and need a
  loop or conversion). Toggles travel in the bookmark.
- **Per-step alternate selection** — any node in the tree that has alternate
  recipes shows an inline picker, so you can swap a recipe deep in the chain and
  watch the whole plan re-solve. Choice is per item (it applies wherever that item
  is made), and your picks travel in the bookmark.
- **Alternate recipes** — the picker stays uncluttered (alternates hidden); when a
  recipe has alternates, a variant selector appears so you can switch between them.
- **Bookmarks** — every plan encodes into a short string that also lives in the
  URL. Copy the link (or the string) to save or share a plan; paste it to
  restore. Fully client-side, reversible, no server.

Planned next: overclock/clock-speed and multi-line plans.

## Project layout

```
index.html            app shell; loads the scripts below in order
src/
  main.js             bootstrap + version selector
  ui/                 views (DOM only)
  engine/             pure, deterministic math (no DOM, no I/O)
  data/
    SCHEMA.md         dataset schema
    versions.js       available game-data versions
    normalize.js      Docs.json -> dataset (shared by importer + gen script)
    <version>/recipes.js   generated dataset, self-registering (committed)
tools/
  import.html         in-browser Docs.json -> recipes.js importer
  gen-data.js         equivalent dev-only Node bootstrap (zero deps)
tests/                browser + Node test runner (no framework)
resources/gamedata/   raw Docs.json exports (provenance for the datasets)
```

Everything hangs off a single global, `BeanCounter` (e.g. `BeanCounter.calculator`,
`BeanCounter.datasets["1.2"]`), so files compose without modules.

## Updating game data

Datasets are generated from the game's `Docs.json` export
(`…/Satisfactory/CommunityResources/Docs/en-US.json`, UTF-16 encoded). Two
equivalent paths — both run the **same** `normalize.js`:

1. **In the browser:** open `tools/import.html`, choose the version + file, and
   download `recipes.js` into `src/data/<version>/`.
2. **Maintainers:** drop the export at `resources/gamedata/<version>/docs.en-us.json`
   and run `node tools/gen-data.js <version>`.

Then add the version to `src/data/versions.js` and reference its `recipes.js`
from `index.html`. (Node here is a dev-only convenience with zero dependencies —
it is not required to run the app.)

## Tests

```sh
node tests/engine.test.js     # or open tests/index.html in a browser
```

## Principles

- **Client-side only.** No backend, no secrets, nothing to install to run it.
- **Runs from the filesystem.** Clone and double-click; no server required.
- **Supply-chain-conscious.** Default to zero runtime dependencies. Any
  third-party library must be vendored or pinned with Subresource Integrity.
- **Deterministic.** Generated data is byte-stable; same input → same output.

## License

[MIT](LICENSE) — free to use, modify, and build on, with attribution.
