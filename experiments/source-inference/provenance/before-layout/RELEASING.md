# Public release plan

Publish this as an experimental Angular capability-analysis package. It is a compiler pass alongside Angular, not a replacement Angular compiler. The compiler-integrated path uses the target application's installed `@angular/compiler-cli` and matching TypeScript, then compiles a generated directive/registry through its normal Angular build. The older analysis path retains `typescript` and `@angular/compiler` dependencies.

## What consumers install and deploy

| Piece | Where it belongs | Purpose |
| --- | --- | --- |
| Analysis CLI and TypeScript/Angular parser dependencies | Developer machine or CI, normally a dev dependency | Inspect source and emit capability manifests |
| Reviewed manifest and generated tool catalog | Application/backend build artifacts | Describe the specifically reviewed tool surface |
| Generated WebMCP module | Browser application, when WebMCP is used | Register reviewed contracts and execute through the existing UI |
| Browser/MCP execution adapter | Optional local or controlled Node service | Connect an external MCP client to an authenticated browser session |
| Public sample checkouts and benchmark harness | Source repository / development only | Reproduce the research results |

The customer's browser does not need the TypeScript checker or Angular template parser. Compile at build time, then deploy the generated contracts and execution adapter. The MCP CLI supports `--manifest` so its startup does not need application TypeScript source. It also supports source analysis as a development convenience.

The current alpha uses one npm package with separate CLI/browser entry points and split JavaScript chunks. Its npm payload excludes the five applications, tests, fixtures, benchmark artifacts and caches. Dependencies are installed separately by npm; the tarball-size report is not the total installation size.

For a later stable release, split into a development CLI/core package, a small browser runtime package, and an optional MCP browser-adapter package. Keep one versioned manifest format between them. An `ng add` schematic and Angular CLI builder can automate installation/build integration later; neither exists in this prototype. Angular documents [custom builders](https://angular.dev/tools/cli/cli-builder) as the supported place for a separate build task.

## Compiler-to-runtime evidence

The new default integration workflow is `angular-mcp-integrate` followed by the application's normal Angular build/serve and `angular-mcp-integrated-browser`. It stages copies rather than changing upstream business source. Generated form tools and exact native/ARIA interactions operate in optimized AOT builds; the older inference runtime has separate development-build limitations.

Before publishing a change to this integration, run:

```sh
npm run test:integration
npm run test:integration-eval
npm run benchmark:integration -- --install
npm run check:integration-evidence -- --require-parity
# Prepare/replay the separate fourth project as documented in its README:
npm run check:integration-holdout
```

The three-project measurement owns and stops its servers, preserves native/raw/UI transport results separately, and refuses report overwrites. The strict check requires every native-passing case and both MCP-only identity boundaries to pass. It also rejects stale code, changed frozen inputs, incomplete case coverage, weak payload assertions, and transport failures counted as validation. Its fixed native baseline retains the source-blocked one-pixel avatar case. The fourth-project check retains its failed first compiler pass and three upstream display failures while requiring exact native snapshot parity. Follow `evaluation/integration-unseen/README.md` and `evaluation/integration-holdout/notes-manager/README.md` for source pins, setup and replay paths; `HOLDOUT_SOURCE_DIR` can locate a separately fetched pinned checkout.

These are finite conformance and development measurements. They do not establish discovery precision/recall for arbitrary unseen applications or real production backends. Runtime-DOM nodes have explicit provenance separate from compiler-resolved nodes. UI values, model observations and business effects are separate contracts. The package remains private and no publication is performed by these checks.

## Prepare the public repository

1. Run `npm run samples:setup`, `npm run samples:fresh -- --install`, `npm exec playwright install chromium`, `npm run verify`, `npm run test:eval`, `npm run benchmark`, and `npm run benchmark:fresh`. Then run `npm run release:check`. Both the original development-corpus gate and the fresh-project tested-scope gate must pass before npm publication. These gates preserve raw schema mismatches, explicit argument mappings, and the unsupported Angular4 result; they are not a general production-readiness claim.
2. Inspect the public source, `artifacts/public-corpus.json`, and each `artifacts/samples/*/runtime.json`. Keep unsupported outcomes visible. Selected-workflow results do not prove the whole application is agent-ready.
3. Keep `test-apps/`, `.cache/`, `node_modules/`, `dist/`, and `release/` ignored. Commit the sample registry, setup script, dependency locks/overlay, reviews, attribution, and reproducible tests. Checkouts are fetched from upstream rather than redistributed inside this repository.
4. Check the MIT license and contributor attribution. Upstream licenses are recorded in `THIRD_PARTY_NOTICES.md` and the pinned fixture catalog. Modern Store declares MIT in its README only; its application source must stay outside the npm payload. Keep source/freeze/lock hashes and the original failed measurements in the public research repository.
5. Create a new public GitHub repository for the compiler project, add it as the remote, review the staged file list, then push. Do not make the surrounding experiments workspace public. The repository has no automatic publishing workflow.

The included CI workflow runs regression verification and measurements. Original-corpus measurement completes even when compiler scores are low. `release:check` is a separate failing gate; `prepublishOnly` runs those two measurements and gates, and additionally requires the current strict integration evidence and fourth-project checks. Sample business source must stay unchanged; source manifests and Git revisions are verified. The additional fresh cohort has 34 operations: 27 unchanged business-payload workflows plus seven TodoMVC workflows, three of which need documented mappings to the generated schemas.

## Publish an npm alpha

Choose an npm scope you control and verify ownership/name availability. Set the public GitHub URL in `repository`, `homepage`, and `bugs` before publishing. The package currently has `private: true`, so accidental publishing is blocked.

After the package contents and alpha scope are agreed, the owner can run:

```sh
npm pkg set name='@YOUR_SCOPE/angular-mcp-compiler'
npm version 0.1.0-alpha.1 --no-git-tag-version
npm pkg set private=false --json
npm install --package-lock-only --ignore-scripts
npm run verify
npm run test:eval
npm run benchmark
npm run benchmark:fresh
npm run release:check
npm pack --dry-run
npm login
npm publish --access public --tag alpha
```

These are owner-run release commands; nothing has been published by this experiment. Follow npm's current [scoped public package guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages) for account authentication and publishing requirements. Use an alpha tag so ordinary `latest` installs do not imply stable support. Review the exact tarball, not just the repository tree: npm's [`files` allowlist](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files) controls what is shipped.

The package check creates a local candidate under `release/`, reports its complete payload, and runs the extracted CLI outside the source tree. This verifies package assembly without publishing it.

## Ground-truth release gate

The original source-reviewed development corpus contains 34 semantic operations. Its gate requires no false positives or missing operations, every gold operation runnable, every matched input contract passing its field/required/probe checks, and a verified execution effect for every gold operation. It rejects static-only and stale reports. Ground truth v2 records the source-backed empty-comment correction; the prior labels and result are archived.

The fresh gate verifies a stable compiler/evaluator snapshot, immutable labels, pinned current source/locks, exact runtime-evidence hashes, all 27 shop/tracker effects, and all seven TodoMVC generated-contract effects plus its four boundary checks. Raw precision and schemas stay visible. Scoped precision uses only independently recorded inventory exclusions. Two shop email-format approximations are audited separately, and TodoMVC's three mappings are explicit. A gate pass means these named development integrations work; it does not turn their failed first passes into held-out successes.

The ground truth is authored by the same development agent and has not been independently adjudicated. Even a passing score would require broader review and holdout projects before claiming general accuracy. See [evaluation/README.md](evaluation/README.md) for definitions, limitations, and failure evidence.

## Honest initial release scope

Describe the release as experimental discovery plus reviewed local development-build UI execution. Claim tested versions/patterns from the reports: Angular14/15 examples, the installed course/RealWorld toolchains, Angular20 store/tracker, and Angular21 TodoMVC. This is not a promise for every intervening Angular version or project. Record exact revisions, locks and toolchain versions.

For the compiler-integrated path, claim only the measured AOT, version and native/ARIA interaction scope. Do not claim automatic exposure of all methods, inferred authorization, production-grade completion, or native WebMCP certification. Route guards and backend permissions remain application responsibilities. The tested plans include source-proven dialogs, nested control wrappers, scoped row identities, complete option refinement, counters, inline/keyboard editing and CDK dragging. For the older inference path, arbitrary widgets, nested repeated collections, production-build identities, feature flags and source-to-deployed-build matching still need work. The new integration separately tests production instance identity and rejects stale handles; unsupported opaque interactions remain explicit. Angular4 is unsupported. The forms-course final create handler remains an unfinished upstream exercise; its draft flow is the verified scenario.

A browser-backed MCP tool still requires a browser session. This prototype does not synthesize a server API from arbitrary frontend code. Native WebMCP interoperability, wider Angular-version coverage, independent label adjudication, and a holdout precision/recall benchmark remain separate release milestones.
