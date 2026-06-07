// run.js — browser test runner (externalized so the page runs under a strict
// `script-src 'self'` CSP). Reads the tests registered on the BeanCounter global
// by engine.test.js and renders the results.
(function () {
  'use strict';
  var out = document.querySelector('#out');
  var failed = 0;
  var tests = window.BeanCounter.tests;
  tests.forEach(function (entry) {
    var name = entry[0], fn = entry[1];
    var li = document.createElement('li');
    try { fn(); li.className = 'ok'; li.textContent = 'ok   ' + name; }
    catch (err) { failed++; li.className = 'fail'; li.textContent = 'FAIL ' + name + ' — ' + err.message; }
    out.append(li);
  });
  var s = document.querySelector('#summary');
  s.textContent = failed ? (failed + ' failing') : (tests.length + ' passing');
  s.className = 'summary ' + (failed ? 'fail' : 'ok');
})();
