// main.js — app bootstrap. Classic script. Reads the preloaded version list and
// datasets off the BeanCounter global, wires the version selector, mounts a view.
(function (BC) {
  'use strict';

  function init() {
    const app = document.querySelector('#app');
    const versionSel = document.querySelector('#version');
    const versions = BC.versions || { versions: [] };

    for (const v of versions.versions) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label || v.id;
      versionSel.append(opt);
    }
    versionSel.value = versions.default || (versions.versions[0] && versions.versions[0].id);

    function select(version) {
      app.innerHTML = '<p class="muted">Loading game data…</p>';
      BC.data.loadDataset(version)
        .then((dataset) => BC.ui.mountPlanner(app, dataset))
        .catch((err) => { app.innerHTML = '<p class="error">Could not load dataset ' + version + ': ' + err.message + '</p>'; });
    }

    versionSel.addEventListener('change', () => select(versionSel.value));
    select(versionSel.value);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
