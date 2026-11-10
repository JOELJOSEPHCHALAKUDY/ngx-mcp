# Fresh production-access cohort

These three MIT public apps were selected and source-labelled before installing dependencies, building originals, running ngx-mcp, or inspecting generated metadata. All source/lock files are pinned; each directory freezes labels, an inventory, source hashes, and the original license.

| App | Complexity | Framework |
| --- | --- | --- |
| dilanka-rathnasiri/todo-app | Small Bootstrap modal, NgModel/signals, repeated task rows | Angular 20.3.12 |
| rajdhokai/EasySprint | Material dialogs/selects, guarded demo login, projects/tasks | Angular 20.0.0 |
| julianNordin/expense-tracker-angular | Reactive lazy forms, money CVA, nested budgets, async validation, HTTP-like local backend | Angular 22.1 |

The current verified packet is [release-alpha-0.1.0-alpha.1/report.json](runs/release-alpha-0.1.0-alpha.1/report.json), indexed by [latest-matrix.json](latest-matrix.json). All **nine optimized production builds**, **64/64 business/native-boundary checks**, and **132/132 framework checks** passed. The final process exited zero. Engine, harness, root lockfiles, installed runtime metadata, and all original source/label checks stayed stable; owned browser/server cleanup completed.

| Project | Business/native cases across four paths | Framework boundaries |
| --- | ---: | ---: |
| Todo | 16/16 | 44/44 |
| EasySprint | 24/24 | 44/44 |
| Expense tracker | 24/24 | 44/44 |

The compiler records no error diagnostics. It retains **three Sprint warnings** for `cdkDropListDropped` and **seven Expense warnings** for custom directive outputs (`confirmed`, `changed`, `retry`, `remove`). Those output interactions are outside the selected workflows and are not certified by this matrix; matching warning diagnostics remain bound to each generated manifest.

These final results are regression evidence on the source-first cohort. First attempts and methodology failures are retained below; this is not an independently adjudicated blind accuracy study or a guarantee for arbitrary apps.

All testing uses synthetic local browser data. Original sources and frozen labels stay unchanged. Runtime and policy configuration must be written outside upstream source. Baseline checks use native DOM interactions and storage postconditions, not generated tool acknowledgements. UI value mappings are explicit; every domain payload field and unchanged neighbour must match.

The Todo app accepts blank titles through its Add button despite its required input. This is a frozen upstream quirk, not a passed negative validation test. EasySprint stores demo passwords in localStorage and does not provide a production identity/backend authorization system; its source behaviour cannot certify account security. The expense app uses its own fake HTTP backend and integer öre values.

The labels select workflows and boundaries, not every method or business branch. They are development-agent authored, not independently human adjudicated. First integration failures must remain preserved; remediation makes a project development evidence rather than an untouched holdout. Framework policy denial/isolation/approval checks are recorded separately from native validation.

## Reproduce original baselines

From the ngx-mcp root with its supported Node installed:

```sh
node_modules/.bin/node evaluation/production-fresh/fetch.mjs --install
node_modules/.bin/node evaluation/production-fresh/fetch.mjs --verify
```

For each source checkout, run its own Angular CLI production build using the supported Node (`node /path/to/checkout/node_modules/@angular/cli/bin/ng.js build --configuration production`). The default checkout paths are listed in `projects.json`; environment variables `PRODUCTION_SOURCE_TODO`, `PRODUCTION_SOURCE_SPRINT`, and `PRODUCTION_SOURCE_EXPENSE` can choose other pinned checkouts. Then replay the original UI with a new output filename:

```sh
node_modules/.bin/node evaluation/production-fresh/reference.mjs --out /tmp/production-fresh-native-replay.json
```

The first original report is `native-original.json`: **16/16** frozen source-authored cases pass (11 positives, including the declared blank-title Todo quirk, plus five source-native refusals/cancellation checks). Source manifests match before/after. `baseline-logs/` retains all unchanged-source install/production-build logs. None of these original runs includes a generated registry.

The framework transport driver interface is `fill(locator,value)`, `activate(locator,{expectUnavailable?})`, `select(locator,value,{label?})`, and `submit(form,{expectInvalid?})`. All action-under-test interactions must use the selected MCP/WebMCP transport; source-known UI locators only choose exact live IDs. `prepareCase` may use the source login UI as an explicit precondition for a project/task case. A policy denial is not a passed source-validation test. `verifyCase` compares every business field plus unchanged neighbours in storage; UI acknowledgements alone cannot pass.

## Reproduce the production matrix

After the ngx-mcp runtime is frozen, run this from the repository root. Choose a new directory for every attempt; the runner refuses to overwrite reports.

```sh
node_modules/.bin/node --import tsx evaluation/production-fresh/run.mjs --out /tmp/ngx-mcp-production-matrix-attempt-1
```

The runner stages separate copies and delegates every optimized build to that project's installed Angular CLI. It tests `mcp` with the official SDK over authenticated Streamable HTTP, `webmcp` through actual Chrome `document.modelContext`, and `both` through each path in separate browser contexts. The installed Chrome must expose WebMCP; the runner enables its experimental browser flags explicitly and records the version. It does not substitute an API shim.

The frozen business denominator is **64**: 16 original cases × four paths (44 positive/upstream-quirk checks and 20 native refusal/cancellation checks). **132 additional framework checks** cover missing, expired and revoked app authentication; default-denied source IDs; server-denied source access; denied model/value reads; denied approval; a changed authenticated subject; cross-session handles; and audit redaction. A disabled or invalid original UI is distinguished from a policy/network refusal.

For each staged manifest, the fixture records a review of exact compiler source IDs in the selected original components and generates an explicit policy for those IDs and that build ID. It grants no model/value/view reads and no runtime-DOM IDs or wildcard sources. Form field grants use compiler form ownership. This policy is an evaluation configuration, not a production authorization policy for the upstream demo apps.

The local trusted fixture uses an HttpOnly random cookie, server-side session validation and an out-of-page approval controller. Its browser bootstrap holds no credential or ability to change its own grants. MCP additionally uses ES256-signed access tokens with issuer, exact resource audience, subject and scopes checked on each request by the hosted gateway. Each test owns a separate browser context, gateway/session and synthetic app state. Gateway tests use explicit loopback HTTP and a locally pinned public key: an external identity provider, real TLS reverse proxy and browser egress policy deployment remain outside this corpus run.

Each report binds engine/harness hashes, root package/lock hashes, installed Node/SDK/jose/Playwright versions, pinned sources, reviewed policy, manifest/runtime/bundle hashes, actual tool calls, redacted server audit, exact business postconditions, and cleanup. Build failures and failed first executions remain in their attempt directories. `selectedScopePassed` requires every selected case, boundary and integrity check to pass; it does not certify arbitrary Angular applications or production deployment security. `releaseReady` remains false in these experiment reports.


## Verify evidence and preserved attempts

The runner automatically writes the raw report SHA sidecar, completion record, and an artifact manifest. Each mode retains its reviewed policy, audit/build logs, original manifest bytes, generated runtime and optimized browser files under `artifacts/`; validation does not need the historical `/tmp` build outputs. Original source clones are still verified against their pinned commits and manifests; use `fetch.mjs --verify` or recreate the pins with `fetch.mjs --install` first. Source overrides `PRODUCTION_SOURCE_*` remain supported.

From the root, verify the latest packet or a newly generated packet:

```sh
node_modules/.bin/node tooling/check-production-evidence.mjs
node_modules/.bin/node tooling/check-production-evidence.mjs --report /tmp/ngx-mcp-production-matrix-attempt-1/report.json
```

Engine, harness, package/lock or installed-runtime changes make existing evidence stale. Regenerate the whole matrix after such changes. Documentation edits do not change its execution inputs. Test-only loopback HTTP and locally pinned JWT keys exercise the authenticated network channel; real TLS/identity-provider deployment and upstream application account security remain outside the measured scope. Reports deliberately keep `releaseReady:false`.

The first integrated attempt, [first-full-matrix-2026-11-10](runs/first-full-matrix-2026-11-10/report.json), recorded **52/64** and **128/132**. Twelve Sprint scenarios stopped on an incorrect evaluator assumption that every route must publish `angular_fill` before opening a dialog; four Expense metadata checks used a sentinel longer than the original input's maxlength. Neither result was relabelled as passing. Its exact seven-file evaluator snapshot is in `harness-snapshots/first-integrated-attempt/`. The first engine is reconstructed and hash-verified in `compiler-snapshots/first-full-matrix/`; `snapshot.json` records that reconstruction honestly.

The intermediate `final-regression-2026-11-10` was invalidated during security review and stopped; `abort.json` excludes its post-browser-shutdown errors from engine outcomes. A later preserved [62/64,132/132 packet](runs/final-complete-2026-11-10/report.json) exposed two remaining evaluator assumptions about freeform disabled-action reasons, which production redaction intentionally removes. The corrected driver instead requires guarded disabled metadata and an exact structured UI refusal with no changed targets. [Focused real transport checks](driver-refusal-focus.json) prove that denied approval, revoked authentication and a closed transport cannot pass as native UI refusals. The final full replay above passed with that corrected driver and unchanged engine. Frozen business labels and all three upstream projects remain unmodified throughout.


The independent release check passed after the final replay: native conformance, all 9/64/132 matrix assertions, portable packet relocation, and **13 rejected tamper variants**. The gate accepts recorded matching warnings and rejects error diagnostics, stale inputs, changed payloads and missing evidence. No application or evaluator source changed after the passing replay.


The public-alpha metadata was subsequently frozen as `ngx-mcp@0.1.0-alpha.1` and the complete unchanged-engine matrix was replayed in `runs/release-alpha-0.1.0-alpha.1/`: **9/9 production builds, 64/64 business/native cases and 132/132 framework checks passed**, process exit zero. All source, harness, installed-runtime and root package/lock snapshots remained stable, and cleanup completed. `latest-matrix.json` now indexes that release-bound packet. The earlier `final-verified-2026-11-10` packet remains preserved; its package-metadata binding is historical. This experiment does not perform the npm publication itself.
