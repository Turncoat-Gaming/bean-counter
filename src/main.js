// main.js — app bootstrap. Loads the version index, lets you pick a game-data
// version, and mounts the active view. Kept thin on purpose.

import { loadVersions, loadDataset } from './engine/dataset.js';
import { mountRateCalculator } from './ui/rate-calculator.js';

const app = document.querySelector('#app');
const versionSel = document.querySelector('#version');

async function selectVersion(version) {
  app.innerHTML = '<p class="muted">Loading game data…</p>';
  try {
    const dataset = await loadDataset(version);
    mountRateCalculator(app, dataset);
  } catch (err) {
    app.innerHTML = `<p class="error">Could not load dataset ${version}: ${err.message}</p>`;
  }
}

async function init() {
  let versions;
  try {
    versions = await loadVersions();
  } catch (err) {
    app.innerHTML = `<p class="error">Could not load versions.json: ${err.message}.
      If you opened index.html directly from disk, serve it instead
      (see the README) — browsers block module loading over file://.</p>`;
    return;
  }

  for (const v of versions.versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label ?? v.id;
    versionSel.append(opt);
  }
  versionSel.value = versions.default ?? versions.versions[0]?.id;
  versionSel.addEventListener('change', () => selectVersion(versionSel.value));

  selectVersion(versionSel.value);
}

init();
