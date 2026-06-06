// plan-codec.js — reversible "bookmark" encoding for plans. No DOM.
//
// A plan is serialized to compact JSON, UTF-8 encoded, then base64url'd behind a
// short version tag. The result is a copy-pasteable string that also lives in
// the URL hash, so a link IS a saved plan. This is encoding, not hashing — fully
// reversible, no server, deterministic. The version tag lets the format evolve
// without breaking old bookmarks.

const TAG = 'bc1.'; // bump when the on-the-wire plan shape changes

// A plan is intentionally minimal and stable:
//   { v: <datasetVersion>, e: [ { r: <recipeKey>, t: <targetRate> }, ... ] }
// Helpers below convert between this wire shape and the app's working object.

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
export function encodePlan(plan) {
  const wire = {
    v: plan.version,
    e: plan.entries.map((x) => ({ r: x.recipeKey, t: x.targetRate })),
  };
  const json = JSON.stringify(wire);
  return TAG + bytesToB64url(new TextEncoder().encode(json));
}

// Decode a bookmark string -> working plan. Throws on a malformed/foreign tag.
export function decodePlan(str) {
  const s = String(str).trim();
  if (!s.startsWith(TAG)) throw new Error('not a bean-counter bookmark');
  const json = new TextDecoder().decode(b64urlToBytes(s.slice(TAG.length)));
  const wire = JSON.parse(json);
  return {
    version: wire.v,
    entries: (wire.e ?? []).map((x) => ({ recipeKey: x.r, targetRate: x.t })),
  };
}
