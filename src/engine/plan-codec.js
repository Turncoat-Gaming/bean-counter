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

  // Encode a working plan -> string.
  //   { version, entries:[{ recipeKey, targetRate, choiceKeys:[recipeKey…],
  //                          recycleItems:[itemKey…] }] }
  // choiceKeys are per-step recipe overrides (deep alternates); the item each
  // applies to is the recipe's primary product, so we store only the recipe key.
  // recycleItems are item keys whose byproducts are credited back (recycling on).
  function encodePlan(plan) {
    const wire = {
      v: plan.version,
      e: plan.entries.map((x) => {
        const o = { r: x.recipeKey, t: x.targetRate };
        if (x.choiceKeys && x.choiceKeys.length) o.c = x.choiceKeys;
        if (x.recycleItems && x.recycleItems.length) o.y = x.recycleItems;
        return o;
      }),
    };
    return TAG + bytesToB64url(new TextEncoder().encode(JSON.stringify(wire)));
  }

  // Decode a bookmark string -> working plan. Throws on a malformed/foreign tag.
  // Old bookmarks without `c`/`y` decode to empty choiceKeys / recycleItems.
  function decodePlan(str) {
    const s = String(str).trim();
    if (!s.startsWith(TAG)) throw new Error('not a bean-counter bookmark');
    const json = new TextDecoder().decode(b64urlToBytes(s.slice(TAG.length)));
    const wire = JSON.parse(json);
    return {
      version: wire.v,
      entries: (wire.e || []).map((x) => ({
        recipeKey: x.r, targetRate: x.t, choiceKeys: x.c || [], recycleItems: x.y || [],
      })),
    };
  }

  BC.codec = { encodePlan, decodePlan };
  if (typeof module === 'object' && module.exports) module.exports = BC.codec;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
