# TodoMVC Angular 21 fresh holdout and regression

Pinned source: [tastejs/todomvc](https://github.com/tastejs/todomvc) commit `ff43b02e59dfa604386bb382034b2cd07c2bcd8a`, `examples/angular`. The repository's explicit MIT license and original dependency lock are retained. Source labels were frozen before compiling this project; `FREEZE.sha256` covers the source-derived operations, references, contracts, effects and exclusions.

## Preserved untouched results

- Independent DOM reference: **7/7 business operations**, plus **4/4 validation/edit boundaries**.
- First compiler pass: **1/7 exact frozen-input effects**, **2/7 allowing the separately recorded `completed` → `checked` rename**. Filtering and Enter creation were missing; row toggle, edit and delete were blocked.
- `first-pass-manifest.json`, `first-pass-runtime-results.json`, `reference-results.json`, the initial reference timing failure, and exact `.snapshot` runner sources remain unchanged.

## Remediated regression

The generated tools now execute all **7/7 compiler-native business effects**, with **4/7 exact frozen inputs**. The other inputs are mapped explicitly in `replay-input-mappings.json`: filter name to authored router path, bulk completion to the source control's `checked`, and row toggle to an explicit desired checkbox value. These are separate from raw schema agreement. Duplicate titles and an already-open editor on another row are refused without mutation; blank editing deletes and blank creation rejects as source requires.

This replay is regression evidence on a now-known project. It does not change the untouched first-pass score. No application source or manifest patches were used.

## Replay

From the compiler project root, using its pinned Node 24:

```sh
npm run samples:fresh -- --only todomvc-angular21 --install
node_modules/.bin/node evaluation/fresh/todomvc-angular21/reference.mjs
FRESH_FINAL=1 node_modules/.bin/node --import tsx evaluation/fresh/todomvc-angular21/mcp-runtime.mts
```

The runners default to `test-apps/fresh-todomvc/examples/angular`, verify the frozen source and lock, and start/stop their own Angular development server on an isolated local port. `HOLDOUT_SOURCE_DIR` overrides that source directory; `HOLDOUT_ARTIFACT_DIR` overrides output location. `HOLDOUT_SERVER_MODE=external` explicitly uses the local server at `HOLDOUT_BASE_URL` instead.

Outputs use `replay-*` names. MCP runs through the official SDK Client and `createMcpServer` over linked `InMemoryTransport`, with real `tools/list` and `tools/call` requests. Fixtures are synthetic UI interactions; there is no backend in the app, and off-origin network requests are blocked. The source's delete-hover prerequisite is recorded explicitly.

`replay-provenance.json` records source, evaluator and compiler file hashes, standard `treeDigest('src')` before/after compile and execution, and baseline evidence hashes. `validForFinalGate` requires unchanged compiler source, preserved baseline evidence, 7 verified compiler-native effects and all four boundary checks. `FRESH_FINAL=1` makes a failed gate exit nonzero.
