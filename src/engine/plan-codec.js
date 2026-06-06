// plan-codec.js — reversible "bookmark" encoding for plans. No DOM.
//
// Classic script: API lives on the `BeanCounter` global (loads over file://);
// also CommonJS-exports for the Node test runner.
//
// A plan is serialized to compact JSON, UTF-8 encoded, then base64url'd behind a
// short version tag. The result is a copy-pasteable string that also lives in the
// URL hash, so a link IS a saved plan. This is encoding, not hashing — fully
// reversible, no server, deterministic. The tag lets the format evolve without
// breaking old bookmarks.
(function (BC) {
  'use strict';

  const TAG = 'bc1.'; // bump when the on-the-wire plan shape changes

  function bytesToB64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Encode a working plan { version, entries:[{recipeKey, targetRate}] } -> string.
  function encodePlan(plan) {
    const wire = { v: plan.version, e: plan.entries.map((x) => ({ r: x.recipeKey, t: x.targetRate })) };
    return TAG + bytesToB64url(new TextEncoder().encode(JSON.stringify(wire)));
  }

  // Decode a bookmark string -> working plan. Throws on a malformed/foreign tag.
  function decodePlan(str) {
    const s = String(str).trim();
    if (!s.startsWith(TAG)) throw new Error('not a bean-counter bookmark');
    const json = new TextDecoder().decode(b64urlToBytes(s.slice(TAG.length)));
    const wire = JSON.parse(json);
    return {
      version: wire.v,
      entries: (wire.e || []).map((x) => ({ recipeKey: x.r, targetRate: x.t })),
    };
  }

  BC.codec = { encodePlan, decodePlan };
  if (typeof module === 'object' && module.exports) module.exports = BC.codec;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
