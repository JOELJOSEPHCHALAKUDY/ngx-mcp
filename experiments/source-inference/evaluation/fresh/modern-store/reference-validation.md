# Independent UI reference validation

13/13 frozen operations passed against the unmodified pinned upstream UI on 2026-11-09. The tests import only Node built-ins and Playwright, with no compiler, capabilities or generated-runtime imports. Labels and source hashes remained frozen.

Every check starts with a fresh browser context. Initial state comes from normal app boot/static local assets; setup and actions use only DOM clicks, typing or actual pointer drags. No handler/store mutation is called directly. All requests outside the local app origin are aborted; no account, backend or payment is contacted. Oracles read rendered DOM and read-only Angular dev state; Modern Store also reads localStorage.

Run from this directory with a compatible Node runtime:

```sh
/path/to/root/node_modules/.bin/node checks.mjs http://127.0.0.1:4331 /tmp/modern-store-reference-results.json
```

`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` overrides the default root Playwright module location. Source servers currently run from `/tmp/fresh-modern-store`; commands are in prerequisites.md. Tests can target any equivalent unmodified-source local port by the first argument. The output path is the second argument.

Modern Store checks include cart increment/replacement/removal, quantity UI bound, both wishlist collection operations, membership persistence, mock auth flows, non-persisted user, and order success/cart clearing with untouched shipping/payment drafts.
