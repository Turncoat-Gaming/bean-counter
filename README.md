# bean-counter

A personal [Satisfactory](https://www.satisfactorygame.com/) production planner.
Plenty of great planners exist — this one is mine. It runs **entirely in your
browser**: no backend, no accounts, no build step, no npm. Same input, same
results, anywhere.

## Run it

Cross-file ES modules can't load over `file://`, so serve the folder with any
static server and open it:

```sh
# Python (ships with most systems)
python3 -m http.server 8000
# then open http://localhost:8000/

# …or any other static server you like.
```

Or just use the hosted copy via GitHub Pages (if enabled for this repo).

## What it does (today)

- **Rate calculator** — pick a recipe and a target output rate; get the machine
  count, input rates, byproducts, and power draw.
- **Bookmarks** — every plan encodes into a short string that also lives in the
  URL. Copy the link (or the string) to save or share a plan; paste it to
  restore. Fully client-side, reversible, no server.

Planned next: full production-chain solving, power/resource roll-ups, alternate
recipe selection, and multi-line plans.

## Project layout

```
index.html            app shell
src/
  main.js             bootstrap + version selector
  ui/                 views (DOM only)
  engine/             pure, deterministic math (no DOM, no I/O beyond fetch)
  data/
    SCHEMA.md         dataset schema
    versions.json     available game-data versions
    normalize.js      Docs.json -> dataset (shared by importer + gen script)
    <version>/recipes.json   generated dataset (committed)
tools/
  import.html         in-browser Docs.json -> recipes.json importer
  gen-data.mjs        equivalent dev-only Node bootstrap (zero deps)
tests/                browser + Node test runner (no framework)
resources/gamedata/   raw Docs.json exports (provenance for the datasets)
```

## Updating game data

The dataset is generated from the game's `Docs.json` export
(`…/Satisfactory/CommunityResources/Docs/en-US.json`, UTF-16 encoded). Two
equivalent paths — both run the **same** `normalize.js`:

1. **In the browser:** open `tools/import.html`, choose the version + file, and
   download `recipes.json` into `src/data/<version>/`.
2. **Maintainers:** drop the export at `resources/gamedata/<version>/docs.en-us.json`
   and run `node tools/gen-data.mjs <version>`.

Then add the version to `src/data/versions.json`.

## Tests

```sh
node tests/engine.test.js     # or open tests/index.html in a browser
```

## Principles

- **Client-side only.** No backend, no secrets, no npm install to run it.
- **Supply-chain-conscious.** Default to zero runtime dependencies. Any
  third-party library must be vendored or pinned with Subresource Integrity.
- **Deterministic.** Generated data is byte-stable; same input → same output.

## License

[MIT](LICENSE) — free to use, modify, and build on, with attribution.
