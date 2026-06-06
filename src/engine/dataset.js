// dataset.js — dataset registry and queries. Classic script on the `BeanCounter`
// global (loads over file://). No fetch(): datasets register themselves by
// loading their own `recipes.js` via a <script> tag, which works from the
// filesystem where fetch() does not.
(function (BC) {
  'use strict';

  // recipes.js files do: BeanCounter.datasets["<ver>"] = { ...dataset }.
  BC.datasets = BC.datasets || {};

  // Resolve a registered dataset; if it isn't loaded yet, inject its script and
  // wait. (Today every version is preloaded in index.html, so this resolves
  // synchronously — the injection path is here for when versions multiply.)
  function loadDataset(version) {
    if (BC.datasets[version]) return Promise.resolve(BC.datasets[version]);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'src/data/' + version + '/recipes.js';
      s.onload = () => {
        if (BC.datasets[version]) resolve(BC.datasets[version]);
        else reject(new Error('dataset ' + version + ' did not register'));
      };
      s.onerror = () => reject(new Error('could not load dataset ' + version));
      document.head.appendChild(s);
    });
  }

  // Recipes sorted by display name, as [key, recipe] pairs — handy for pickers.
  function recipeList(dataset) {
    return Object.entries(dataset.recipes).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }

  function itemName(dataset, itemKey) {
    return (dataset.items[itemKey] && dataset.items[itemKey].name) || itemKey;
  }

  function buildingName(dataset, buildingKey) {
    return (dataset.buildings[buildingKey] && dataset.buildings[buildingKey].name) || buildingKey;
  }

  BC.data = { loadDataset, recipeList, itemName, buildingName };
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
