---
name: project-security-posture
description: "bean-counter's security model and hardening decisions — small surface, CSP, no-innerHTML-of-untrusted-input."
metadata: 
  node_type: memory
  type: project
  originSessionId: e685ed53-26f4-4109-ab07-b682c381019c
---

[[project-bean-counter]] is public + client-side with no backend or secrets, so
the attack surface is small by construction (no SQLi/SSRF/auth/etc.). Hardening
choices made (2026-06):

- **CSP `<meta>` on every page** (GitHub Pages can't set HTTP headers).
  `index.html` is strict: `default-src 'none'; script-src 'self'; style-src
  'self'`. Tools/test pages use `script-src 'self'; style-src 'self'`.
- **No inline scripts or `onclick=` handlers** — external `<script src>` only, so
  the CSP holds. Inline scripts were externalized (`tools/import.js`, `tests/run.js`).
- **Never `innerHTML` untrusted input** — bookmark/URL-hash, user-imported
  datasets, `err.message`. Bookmark links are attacker-controllable. Use
  `textContent` or the `esc()` helper in `rate-calculator.js`.
- Reminder: enable **"Enforce HTTPS"** in the Pages settings; never commit a
  secret (public history is forever). See [[feedback-no-npm-supply-chain]].
