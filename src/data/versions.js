// versions.js — index of available game-data versions. Classic script: sets
// BeanCounter.versions. Loaded via <script> so it works over file://.
(function (BC) {
  'use strict';
  BC.versions = {
    default: '1.2',
    versions: [
      { id: '1.2', label: 'Update 1.2' },
    ],
  };
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
