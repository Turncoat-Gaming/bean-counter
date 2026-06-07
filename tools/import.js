// import.js — browser logic for the data importer (externalized so the page can
// run under a strict `script-src 'self'` CSP, i.e. no inline scripts).
(function () {
  'use strict';

  var normalize = window.BeanCounter.normalize;
  var fileEl = document.querySelector('#file');
  var versionEl = document.querySelector('#version');
  var statusEl = document.querySelector('#status');
  var downloadBtn = document.querySelector('#download');
  var blobUrl = null;

  function setError(msg) {
    statusEl.textContent = '';
    var span = document.createElement('span');
    span.className = 'error';
    span.textContent = 'Failed: ' + msg;
    statusEl.append(span);
  }

  fileEl.addEventListener('change', async function () {
    var file = fileEl.files[0];
    if (!file) return;
    statusEl.textContent = 'Reading…';
    downloadBtn.disabled = true;
    try {
      var buf = await file.arrayBuffer();
      // Satisfactory exports UTF-16LE with a BOM.
      var text = new TextDecoder('utf-16le').decode(buf);
      var dataset = normalize.normalizeDocs(JSON.parse(text), { gameVersion: versionEl.value.trim() });
      var js = normalize.serializeDataset(dataset);

      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(new Blob([js], { type: 'application/javascript' }));
      downloadBtn.disabled = false;
      statusEl.textContent =
        'OK — ' + Object.keys(dataset.items).length + ' items, ' +
        Object.keys(dataset.buildings).length + ' buildings, ' +
        Object.keys(dataset.recipes).length + ' recipes.';
    } catch (err) {
      setError(err.message);
    }
  });

  downloadBtn.addEventListener('click', function () {
    if (!blobUrl) return;
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'recipes.js';
    a.click();
  });
})();
