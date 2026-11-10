# New compiler/runtime integration cohort

These three public projects were selected and source-labeled before running the new integration compiler. Source pins, explicit MIT licenses, source manifests, operation schemas, representative inputs, business oracles, negative cases and exclusions are frozen in each project directory. `freeze.json` hashes the four frozen files. Nothing in the original/fresh benchmark reports or labels is changed by this cohort.

| Project | Pinned revision | Framework at locked install | Positive scenarios | Negative/boundary cases |
| --- | --- | --- | ---: | ---: |
| BrunoICosta/angular-finance-tracker | `61c1bb87567df4245f0722713edabc8177121842` | Angular 20.3.18, Material, reactive forms, currency CVA | 13 | 10 |
| diverintech/angular-todo-list | `391435fc4edf819abf4f507187fc0364ac26e00b` | Angular 20.1.2, Material, reactive forms and repeated cards | 5 | 3 |
| BlueIronGirl/shopping-list-frontend | `3464f15ad53ede4de5673415ca9de68070bf78a1` | Angular 16.1.7, PrimeNG, reactive forms and repeated NgModel rows | 17 | 8 |

Todo's five view/state scenarios cover three semantic handlers. Do not describe the 35 scenarios as 35 independently discovered methods. Two ambiguity cases concern generated source/instance identity and are MCP-only; the other 19 negatives have source UI reference checks. No untouched-project accuracy, full schema equivalence, production backend, authorization or native-browser WebMCP claim is made.

Run commands from the compiler repository root using its pinned Node 24.15.0:

```sh
export UNSEEN_SOURCE_ROOT=/tmp
node_modules/.bin/node evaluation/integration-unseen/fetch.mjs --install
node_modules/.bin/node evaluation/integration-unseen/fetch.mjs --verify
node_modules/.bin/node evaluation/integration-unseen/serve.mjs --project finance
node_modules/.bin/node evaluation/integration-unseen/serve.mjs --project todo
node_modules/.bin/node evaluation/integration-unseen/serve.mjs --project shopping
```

Run each serve command in its own terminal. Defaults are untouched `integration-unseen-{finance,todo,shopping}` checkouts under the OS temporary directory, on 4351/4352/4353. Set `UNSEEN_SOURCE_ROOT=/tmp` to reuse the checkouts from this development run. npm uses `NPM_CLI` or `npm_execpath` when provided; otherwise it uses npm from PATH with the pinned Node directory prepended. `UNSEEN_SOURCE_ROOT` can choose another checkout parent. For evaluation with another source directory pass `SOURCE_FINANCE`, `SOURCE_TODO` or `SOURCE_SHOPPING`; the same frozen manifests must match.

References import no compiler or generated capability metadata. They interact only through the original rendered controls, read rendered state and storage, and use an explicitly modeled in-memory HTTP fixture for shopping. Every other external origin is blocked. No real accounts or backend requests are made. Browser time is fixed at 2026-11-10 for reproducible seeded months. Native reference helpers may enter localized money/date values the way a person does; they do not call application methods, CVA setters or form-model setters.

```sh
node_modules/.bin/node evaluation/integration-unseen/run.mjs --mode reference --project all --out /tmp/unseen-reference-new.json
```

Reports refuse to overwrite an existing file. `--project finance|todo|shopping` and `--case <frozen-case-id>` support focused replay. Frozen representative inputs and negative patches remain separate in reports. Case setup uses source UI operations and explicitly recorded route/row selection preconditions. The action under test in MCP mode has no reference fallback.

Create separate generic staged integrations and serve them; originals stay unchanged:

```sh
node_modules/.bin/node --import tsx src/integrate.ts --project /tmp/integration-unseen-finance/tsconfig.app.json --out /tmp/unseen-finance-staged
node_modules/.bin/node --import tsx src/integrate.ts --project /tmp/integration-unseen-todo/tsconfig.app.json --out /tmp/unseen-todo-staged
node_modules/.bin/node --import tsx src/integrate.ts --project /tmp/integration-unseen-shopping/tsconfig.app.json --out /tmp/unseen-shopping-staged
node_modules/.bin/node evaluation/integration-unseen/serve.mjs --project finance --source /tmp/unseen-finance-staged --port 4361
```

Use spaces in the final option (`--port 4361`); serve todo/shopping analogously on 4362/4363. The original repository task used additional versioned staging paths/ports to preserve prior generated builds. A staging path must be new. Each app uses its own installed compiler-cli and TypeScript, then its own ordinary Angular CLI build; application business source is never patched to make a check pass.

```sh
node_modules/.bin/node --import tsx evaluation/integration-unseen/run.mjs --mode mcp --project finance --base-url http://127.0.0.1:4361 --stage-dir /tmp/unseen-finance-staged --out /tmp/unseen-mcp-raw-new.json
UNSEEN_TRANSPORT=native-ui node_modules/.bin/node --import tsx evaluation/integration-unseen/run.mjs --mode mcp --project finance --base-url http://127.0.0.1:4361 --stage-dir /tmp/unseen-finance-staged --out /tmp/unseen-mcp-ui-strings-new.json
```

`--base-url` overrides one selected project's endpoint. The harness uses the real SDK Client, linked InMemoryTransport and `createIntegrationMcpServer`, selecting exact emitted instance IDs from independently located source UI elements. When the server emits a form tool with authoritative `_meta.angularMcpTarget`, that tool is selected directly; otherwise the generic `angular_submit` operation is used. All calls/results are retained. Numeric-to-text normalization in the second command is based only on a live structural string schema and is recorded as an explicit UI transport mapping. It cannot turn a failed amount/cents oracle into a pass; the original business amount must still match exactly. It does not rename business fields, infer service APIs or invoke arbitrary methods.

First failures remain separate. Initial Angular16 and20.1 instrumentation failed because an actual TTC method was absent; a generic version-capability fallback was subsequently added by the compiler agent. Early reference attempts also preserve locator/readiness/fixture mistakes; they are not compiler scores. First runtime reports retain unsupported/custom-control, missing library-template identity and partial-dispatch outcomes. Read before/after snapshots and exact errors; a refusal caused by an unsupported upstream control is not a passed negative-validator test.

The frozen one-pixel avatar fixture currently fails through the original source UI: Cropper supplies a zero-sized canvas, and the app's drawImage throws before any profile request. `shopping/avatar-reference-adjudication.json` records this. It remains in the frozen positive denominator as a blocked reference case. No source fix or frozen image rewrite is allowed; any larger-image extension must be separately labeled nonfrozen.

This evaluation is development evidence after shared fixes. Frozen source-first labels reduce compiler-derived labeling, but there is no independent human adjudication, untouched holdout guarantee for remediated runs, or exhaustive precision/recall/schema score. All successful cases require actual independent business postconditions; `ui-dispatched` alone is never a pass. `historical-evidence.json` records known limitations of earlier attempts: their positive oracles omitted some payload fields, and some early negative attempts conflated transport refusal with validation. These preserved reports cannot establish final full-payload or validator parity. The current `oracles.mjs` checks every frozen payload field plus target identity, unchanged neighbors and declared cascades; its regression tests intentionally supply wrong field values.

Run the complete reproducible measurement (owns and cleans up only the servers it starts):

```sh
node_modules/.bin/node --import tsx evaluation/integration-unseen/measure.mjs
node_modules/.bin/node --import tsx evaluation/integration-unseen/check.mjs
node_modules/.bin/node --import tsx evaluation/integration-unseen/check.mjs --require-parity
```

`measure.mjs --install` also fetches/installs pinned fixtures. It stages under the OS temporary directory, runs source references and both raw/UI-normalized MCP matrices on owned local ports, keeps timestamped reports, and writes `latest-measurement.json`. `--base-port` and `--out` support isolated runs. `nativeParity` requires every source-native passing case to pass its MCP replay using the same independent oracle. Default checking verifies measurement integrity and reports parity gaps. `--require-parity` additionally requires the nonvacuous source baseline (34 passing positives, 19 native rejection/cancel cases, two protocol-only native N/A cases), the source-backed avatar adjudication, every native-passing case through MCP, and both MCP-only ambiguity boundaries. It fails on any such gap. Neither integrity alone nor parity over named cases establishes a production-ready release. All 35 frozen positives, including the source-blocked one-pixel case, remain in the recorded denominator.

UI normalization uses standard ARIA controls and exact registered public focusable option handles. Read-only public control model snapshots establish current object selections, with source-frozen identity-to-visible-label mappings explicitly recorded. Known empty array state must be observed, rather than assumed. Old readonly listboxes are operated with original browser Space/Enter/Escape keyboard events through MCP; no temporary trial toggles infer selection state. Opaque CVAs are never assigned through model setters, and no raw DOM action fallback is used. Raw field/DTO transport failures remain a separate score.

Run independent evaluator counterexample tests with `node_modules/.bin/node --test tests/integration-evaluator.test.mjs evaluation/integration-unseen/oracles.test.mjs`. Frozen labels and original apps remain unchanged.

## Archival restructuring and provenance

The active integration now uses the Node-only `evaluation/digest.mjs` helper, with the same ordered path/byte-hash format as the historical evaluator. Its exact bytes are pinned in both per-phase and complete-matrix evidence. The source-inference prototype and its scoring utilities are separate research code.

The pre-archive evaluator files, shared metrics helper, and latest-result pointer are preserved under `evaluator-snapshots/pre-archive-2026-11-10/`, with an explicit hash manifest. Existing reports and frozen app inputs are unchanged. Moving legacy files out of the active `src` tree changes its digest; a fresh complete matrix, rather than rewritten historical report hashes, is required before the current-source gate passes.
