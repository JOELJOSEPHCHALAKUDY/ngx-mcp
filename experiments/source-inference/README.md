# Archived source-inference experiment

This private package preserves the first approach: infer capabilities and schemas from source, probe them against an app, and expose reviewed UI workflows. New users should use the [current compiler-to-runtime integration](../../README.md).

The original implementation, sample definitions, tests, frozen labels, first-pass failures, and historical reports remain here. They are research history, not a second supported installation path or the current integration's accuracy results.

## Run the archived code

From the repository root:

```sh
npm --prefix experiments/source-inference ci
npm --prefix experiments/source-inference run check
npm --prefix experiments/source-inference test
```

Run any other archived script with `npm --prefix experiments/source-inference run <script>`. Alternatively, `cd experiments/source-inference` and use the commands in the historical sections below. This package has its own dependency lock; installing the main package does not install this experiment's Angular parser dependencies.

The pinned Angular test toolchain is shared through `samples/toolchains`, and fetched upstream applications remain in the repository's ignored `test-apps` folder. `samples:setup` and `samples:fresh` fetch/install those external samples. The sample scripts create the shared checkout directory before using its link, including after `npm ci --ignore-scripts`. If invoking the preserved fetch files directly, run `npm run samples:prepare` first. Browser checks also need Chromium. Neither the source applications nor their dependencies are included in the npm archive.

`verify` checks this older implementation only: types, compiler/probe/evaluator tests, sample generation, browser regressions, extracted package, and corpus validation. The main package's verification does not run the old approach.

Historical measurements bind the source layout and dependency files that produced them. Moving the experiment makes those measurements stale for a new execution; the archived release checks intentionally reject stale results. Rerun measurements explicitly when studying this approach. Keep frozen labels, original failures, and previous reports unchanged rather than changing their hashes to make a gate pass.

**Publishing is disabled:** this package has `private: true` and a failing `prepublishOnly` hook. Its old release plan is retained for historical context. See the [main release guide](../../RELEASING.md) for the current integration.

## Preserved source provenance

[provenance/layout-before.json](provenance/layout-before.json) records the original full `src` tree digest and byte map for all 47 files before cleanup. The preserved files reconstruct SHA-256 `6405f73911b4aab10abe5b8e6e11668d764a7658d43ef1548097b8799cdab13f` exactly.

Original entry-point and configuration snapshots, including the combined `src/index.ts`, package and lock files, TypeScript configurations, and build/package tooling, are retained under [provenance/before-layout](provenance/before-layout). Historical reports still refer to that old source layout; their original hashes remain unchanged and do not certify the current tree.

## Historical instructions and results

## Reproduce the experiment

Use the supported Node version in `package.json` (the workspace pins Node 24.15.0).

```sh
npm ci
npm exec playwright install chromium
npm run samples:setup
npm run samples:fresh -- --install
npm run verify
npm run test:eval
npm run benchmark
npm run benchmark:fresh
npm run release:check
```

`verify` checks types, compiler/source-proof tests, bounded probing, browser/MCP/WebMCP regressions, selected application workflows, and the extracted npm package. The two benchmarks measure every labelled operation separately. Release checks reject stale measurements. They do not publish anything.

## Public projects

The original five examples span different integration patterns. Sources are pinned, fetched separately, and left unchanged.

| Project | Integration complexity |
|---|---|
| [Angular 14 CRUD](https://github.com/cornflourblue/angular-14-crud-example) | Small NgModule application, lazy routes, fake backend |
| [Angular 15 account boilerplate](https://github.com/cornflourblue/angular-15-signup-verification-boilerplate) | Authentication, guarded admin/profile routes, cross-field validation |
| [Angular Forms Course](https://github.com/angular-university/angular-forms-course) | Stepper, custom controls, asynchronous validation, persisted drafts |
| [Angular/Spring Course CRUD](https://github.com/loiane/crud-angular-spring) | Signal Forms, repeated lesson rows, Material widgets, confirmations |
| [Angular RealWorld](https://github.com/realworld-apps/angular-realworld-example-app) | Standalone lazy components, articles, comments, profiles, authenticated effects |

Three additional modern projects were labelled from source before their first compiler tests:

| Project | Labelled operations | Main new patterns |
|---|---:|---|
| [Modern Store](https://github.com/Ankur071/Modern-Store) | 13 | NgRx signal-store factories, typed object selection, quantity controls, Material dialogs |
| [Jira clone](https://github.com/trungk18/jira-clone-angular) | 14 | Projected dropdowns, nested controls, raw user IDs, multi-selects, Quill, CDK dragging |
| [Angular 21 TodoMVC](https://github.com/tastejs/todomvc/tree/master/examples/angular) | 7 | Enter submission, double-click editing, title-based row identities, RouterLinks |

An Angular 4 Todo example is also retained: its original UI passes 4/4 reference checks, but its first compiler run passes 0/4. That version is unsupported. It is not removed from the failure history.

Pins, licenses, immutable source manifests and fetch instructions are in [samples/projects.json](samples/projects.json), [evaluation/fresh/projects.json](evaluation/fresh/projects.json), and [FETCHING.md](evaluation/fresh/FETCHING.md). Sample applications are excluded from the npm package.

## Results and what they mean

The original development corpus contains 34 source-reviewed business operations. Its labels were authored with prior knowledge of the compiler. Ground truth v2 records a source-backed correction to the comment-body constraint and preserves the previous labels. Read the current [original-corpus report](artifacts/evaluation/REPORT.md) for precision, recall, finite schema checks and verified effects.

The remediated fresh-project results are **13/13 shop**, **14/14 tracker**, and **7/7 TodoMVC** business effects through actual MCP calls. Shop/tracker business payloads stay unchanged; route IDs, drag source and confirmation review are recorded as separate context. TodoMVC passes **4/7 with unchanged frozen arguments**; three operations require documented mappings to the generated tool contract. All four TodoMVC boundary checks pass, including ambiguous-title and other-row-editor refusal.

These are development results after fixes, not an untouched accuracy estimate. First-pass failures remain preserved: shop discovered 0/13, tracker found 9/14 but its initial runtime candidates were blocked, and modern TodoMVC initially verified 1/7 unchanged-input effects (2/7 with one rename). See [fresh report](artifacts/evaluation/fresh/REPORT.md), [first-pass artifacts](artifacts/evaluation/fresh-baselines), and [TodoMVC evidence](evaluation/fresh/todomvc-angular21/README.md).

Earlier exploratory source-only labels remain in [evaluation/holdout](evaluation/holdout), with separately authored application studies under `evaluation/independent-app*`. They are research history outside the named current gate, and are not implied to pass by the results above.

Schema results are reported separately:

- Raw frozen-label scores retain parameter/context differences and actual disagreements.
- Business-schema comparison removes only declared route parameters supplied by fixture URL context.
- Two shop email labels use `format: email`, whose default AJV interpretation rejects addresses the original Angular/native UI accepts. The frozen labels remain unchanged; the [independent audit](evaluation/fresh/modern-store/email-audit.md) explains the discrepancy.
- Scoped business precision cites exclusions already recorded in the source-only inventories. Raw unmatched predictions remain visible.
- Schema checks use finite positive/negative payloads, not a proof of equivalence. Tool output is a validated `ui-dispatched` acknowledgement; business effects are checked by independent oracles.

Seeded synthetic instances provide another regression corpus. Seed 2041 now discovers 31/31 operations with no hits among its 13 decoys. Exact contract names/types and explicitly normalized scores are kept separate. Historical measurements and their limitations are in [CONTINUATION.md](artifacts/evaluation/CONTINUATION.md).

## Source-inference certification (older experimental path)

No benchmark shows that static analysis is right for a project it has not seen. So the tool checks itself against your project: with the app's local development build running, it executes every discovered action in a sandbox and keeps only what it saw work.

```sh
angular-mcp-certify --project /path/to/app/tsconfig.app.json \
  --routes src/app/app.routes.ts#routes --base-url http://localhost:4200 --out artifacts/certified
```

For each action it fills the real controls, triggers the original handler, and records the request, storage, navigation or UI change that follows. Requests are intercepted, so nothing reaches a backend. Where the generated contract disagrees with what the app accepts, the contract is repaired from the app's behaviour and probed again. The command writes:

- `manifest.json`, the contracts after repair;
- `approvals.json`, proposed approvals for only the actions whose effect was observed;
- `REPORT.md`, each action as **proven** (effect seen, contract agreed with the app on every probe), **executed** (effect seen with example inputs, constraints not fully confirmed), **unverified** (with the reason) or **blocked**.

Read the report, edit `approvals.json` if needed, then serve it with `angular-mcp-browser --manifest artifacts/certified/manifest.json --approvals artifacts/certified/approvals.json --base-url http://localhost:4200`. Unverified and blocked actions are never offered as tools.

An action that cannot run on a freshly opened page is tried again in the state other certified actions leave behind (a record added by the app's own form, an item put in a cart). The report names the actions that led there. Identifiers come from the app itself: its links, the rows it renders, and records its components hold under the same name as the route parameter.

What the sandbox cannot give an app, you can:

- `--live-reads` lets GET and HEAD requests through to the app's own origin and other local hosts, so the app shows real records. `--read-origin <origin>` adds a development API on another host. Writes never leave the sandbox.
- `--storage-state <file>` starts every attempt from a saved browser session, for actions behind a login. Save one with `npx playwright codegen --save-storage=state.json <local-dev-url>`.
- `--param name=value` supplies a route or row identifier the app does not show.
- `--context` values for drags and confirmations are found by the probe and recorded in the report; a served tool takes them from the host.

### What to expect

Run with no flags on eight open-source applications (Angular 14, 15, 20, 21 and 22), certification proposed 55 of 155 discovered actions: 15 of 20 on a signal-store shop, 12 of 24 on TodoMVC, 12 of 41 on a Jira clone, 7 of 8 on a CRUD app, and 9 of 62 on four apps whose data or login lives in a backend the sandbox does not have. Expect the first run on your app to certify a part of what was found, and the flags above to raise it. These apps were used during development, so the figure is not an untouched accuracy estimate.

The usual reasons an action stays unverified are a backend the sandbox does not have, a login whose session the stubbed backend cannot create, and controls inside a dialog opened from a repeated row. The report gives the reason and the flag that would help for each one.

Certification covers the actions the compiler found. It does not show that every action in the app was found, and sandboxed execution does not establish real backend behaviour. A GET that changes data is outside the write-safety claim. Session storage is not captured. `--base-url` must be a local host.

### How this relates to WebMCP and the research

WebMCP (`document.modelContext.registerTool`) is an unratified draft, and the draft does not validate arguments; the generated entry validates them itself. Angular 22 ships experimental first-party WebMCP support for Signal Forms only ([angular.dev/ai/webmcp](https://angular.dev/ai/webmcp)); this project covers reactive and template-driven forms and non-form actions, and was run on Angular 14, 15, 20, 21 and 22. Published work on machine-generated web tools reports that they solve a minority of benchmark tasks and give no consistent gain over hand-written API tools (arXiv 2604.03465), and that most generated tools are never called. That is why this tool proposes only actions it saw work, keeps the set small, and should be re-run on every build. Keep direct browser access available to the agent alongside the tools.

## Use with an application

To review candidates by hand instead, analyze the app's actual TypeScript configuration and route entry:

```sh
npm run analyze -- --project /path/to/app/tsconfig.app.json \
  --routes src/app/app.routes.ts#routes --out artifacts/app-manifest.json
```

Inspect each candidate's source, fields, schema, effect provenance, issues and workflow plan. Exposure is empty by default. A review file selects capabilities by `id` and exact `fingerprint`, supplies a description, and classifies the effect as `read` or `write`. Source or contract changes invalidate reviews.

Start a local application and serve the reviewed manifest over MCP stdio:

```sh
npm run mcp -- --manifest artifacts/app-manifest.json \
  --approvals review/app.json --base-url http://127.0.0.1:4200 --headed
```

The client must use the generated tool schema. Do not guess argument names from a business label. `--hash` supports hash routing. `--context context.json` supplies separately validated host context for capabilities that declare it. CDK drags need an explicit source container; confirmation business actions need `confirmedCapability` set to that exact reviewed capability ID. Native `confirm()` is dismissed and reported as incomplete unless an embedding person/session handles it.

Dynamic option lists must be refined **before review**. The exported `refineManifest(page, manifest, baseUrl)` reads complete live option IDs/labels and creates new fingerprints. It does not submit the form. Partial or ambiguous lists do not become invented enums. Save and review that refined manifest, then serve it without re-refining into a different contract.

The runtime fills native controls, uses widget DOM events and clicks the original action. It does not replace handlers with service calls. Existing validators, interceptors, router guards, disabled states, overlays and application permissions still apply. Missing or ambiguous controls fail with a reason. Backend rejection is not converted into a fabricated success result.

The generated WebMCP entry uses the same reviewed contracts/runtime and accepts `install({context})`. Registration is tested against a mock browser API; that does not certify native browser interoperability.

## Supported patterns and limits

Tested source patterns include NgModules/standalone lazy routes, static provider overrides, constructor and `inject()` dependencies, source-defined signal-store factories, reactive/template-driven/Signal Forms, nested control wrappers, native/Material/NgZorro controls, complete option refinement, contenteditable/Quill, scoped row actions, inline editing, quantity steppers, keyboard commits, and normalized CDK reorder/transfer operations.

Source inference stays conservative: unknown factories, mutable/escaped option arrays, ambiguous controls, unsupported setters, partial live lists and unresolved context remain blocked or unconstrained with diagnostics. Bounded membership probing emits constraints only after complete evidence; it does not guess a maximum or an email regex when its budget runs out.

Executors currently accept local HTTP origins. Repeated-item targeting needs a development build. Tests use local mock/in-memory backends and synthetic accounts/data. A successful test does not establish every branch, deployed-build matching, production authorization, or a real payment/order workflow. The legacy forms-course final Create Course exercise is unfinished upstream; its implemented draft flow is what is verified.

## Historical release discussion

Ship the analysis CLI/core, reviewed generated contracts, and the appropriate runtime adapter. The browser does not need the TypeScript checker or Angular parser. A future Angular builder can run this analysis during a build; a replacement Angular compiler is unnecessary. The exact pre-cleanup release plan is preserved in [provenance/before-layout/RELEASING.md](provenance/before-layout/RELEASING.md). See [RELEASING.md](RELEASING.md) for this archive's no-publication policy and a link to the current main release guide.

The gates establish the named experimental scope. They explicitly retain raw schema mismatches, argument mappings and the unsupported Angular 4 result. A general production-readiness or untouched-project accuracy claim would require additional evidence.
