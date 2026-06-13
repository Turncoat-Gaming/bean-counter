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
  //   { version, entries:[{ targetItem, rootRecipe?, targetRate,
  //                          choiceKeys:[recipeKey…], recycleItems:[itemKey…],
  //                          providedItems:[itemKey…] }] }
  // targetItem (`i`) is the line's product — what to make. rootRecipe (`r`) is the
  // recipe chosen to make it, stored only when it differs from the item's default
  // (e.g. an alternate, or a byproduct source). choiceKeys are deeper per-step
  // recipe overrides (the item each applies to is the recipe's primary product, so
  // we store only the recipe key). recycleItems are item keys whose byproducts are
  // credited back (recycling on); providedItems are sourced externally.
  //
  // A supply-driven line (`driver === 'supply'`) sizes its output from a fixed
  // input instead of a target rate: it stores `d` (driver flag), `s` (the supply
  // item) and `u` (the supply rate). `i`/`r`/`c`/`y`/`p` still describe the end
  // product and its recipes; the target rate is re-derived on restore, so `t` is
  // a (harmless) cache of the last sized value.
  // Back-compat: older bookmarks carry only `r`; decode derives the item from it.
  //
  // Plan-level (not per-line): the Advanced Game Settings global multipliers — `m`
  // (recipe cost) and `w` (machine power). Both omitted at the default 1×, so
  // existing bookmarks decode to 1× unchanged.
  function encodePlan(plan) {
    const wire = {
      v: plan.version,
      e: plan.entries.map((x) => {
        const o = { i: x.targetItem, t: x.targetRate };
        if (x.rootRecipe) o.r = x.rootRecipe;
        if (x.choiceKeys && x.choiceKeys.length) o.c = x.choiceKeys;
        if (x.recycleItems && x.recycleItems.length) o.y = x.recycleItems;
        if (x.providedItems && x.providedItems.length) o.p = x.providedItems;
        if (x.driver === 'supply') { o.d = 1; o.s = x.sourceItem; o.u = x.supplyRate; }
        return o;
      }),
    };
    if (plan.costMult && plan.costMult !== 1) wire.m = plan.costMult;
    if (plan.powerMult && plan.powerMult !== 1) wire.w = plan.powerMult;
    return TAG + bytesToB64url(new TextEncoder().encode(JSON.stringify(wire)));
  }

  // Decode a bookmark string -> working plan. Throws on a malformed/foreign tag.
  // Old bookmarks without `c`/`y`/`p` decode to empty lists; `targetItem` may be
  // absent on pre-item bookmarks (only `rootRecipe`) — the UI derives it.
  function decodePlan(str) {
    const s = String(str).trim();
    if (!s.startsWith(TAG)) throw new Error('not a bean-counter bookmark');
    const json = new TextDecoder().decode(b64urlToBytes(s.slice(TAG.length)));
    const wire = JSON.parse(json);
    return {
      version: wire.v,
      costMult: wire.m || 1,
      powerMult: wire.w || 1,
      entries: (wire.e || []).map((x) => ({
        targetItem: x.i, rootRecipe: x.r, targetRate: x.t,
        choiceKeys: x.c || [], recycleItems: x.y || [], providedItems: x.p || [],
        driver: x.d ? 'supply' : 'rate', sourceItem: x.s, supplyRate: x.u,
      })),
    };
  }

  BC.codec = { encodePlan, decodePlan };
  if (typeof module === 'object' && module.exports) module.exports = BC.codec;
})(globalThis.BeanCounter = globalThis.BeanCounter || {});
