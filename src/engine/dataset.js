// dataset.js — load and query a versioned bean-counter dataset.
// Pure of UI; only touches the network via fetch() to pull the JSON the
// importer generated. See src/data/SCHEMA.md for the shape.

const BASE = new URL('../data/', import.meta.url);

// Fetch the list of available game-data versions.
export async function loadVersions() {
  const res = await fetch(new URL('versions.json', BASE));
  if (!res.ok) throw new Error(`versions.json: ${res.status}`);
  return res.json();
}

// Fetch one version's normalized dataset.
export async function loadDataset(version) {
  const res = await fetch(new URL(`${version}/recipes.json`, BASE));
  if (!res.ok) throw new Error(`dataset ${version}: ${res.status}`);
  return res.json();
}

// Recipes sorted by display name, as [key, recipe] pairs — handy for pickers.
export function recipeList(dataset) {
  return Object.entries(dataset.recipes)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
}

export function itemName(dataset, itemKey) {
  return dataset.items[itemKey]?.name ?? itemKey;
}

export function buildingName(dataset, buildingKey) {
  return dataset.buildings[buildingKey]?.name ?? buildingKey;
}
