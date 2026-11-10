# Evaluation protocol, version 2

This benchmark asks whether the compiler identifies meaningful Angular operations, emits faithful input contracts, and can carry those operations through the existing UI. It is distinct from the five selected demo scenarios.

## Labels and scope

[ground-truth.json](ground-truth.json) is a frozen source-authored inventory of 34 operations at the five revisions in `samples/projects.json`. Every positive has an application source anchor, line and SHA-256, an independently authored input contract, representative synthetic arguments, setup context, and an expected business effect. The inventory includes mutations, auth, uploads, explicit queries/retries/pagination, persisted drafts and user-followed signed mutation links. Its exclusions document navigation, presentation-only updates, automatic reads, console-only exercises and form substeps.

The same development agent reviewed the sources and authored the labels after developing the compiler. Existing compiler behavior was known. This is provisional ground truth, with no independent human adjudication, blinded labeling, or holdout corpus. Labels are not generated from a compiler manifest. Do not describe the result as general Angular accuracy.

The unit is a semantic operation: create/update and login/register are separate; identical reusable component actions across routes and duplicate form/button bindings count once. Query/filter/sort/pagination that share one parameterized lesson-loading operation count once. Forwarded events count at the actual business handler. Route parameters and repeated-row identities must be expressible as tool inputs. All route variants are listed; execution success of one scenario does not establish every variant or branch.

The runner checks pinned Git revisions, label evidence hashes, unchanged application source, and pre/post snapshots of compiler, evaluator, labels, shared API isolation, dependency files and application sources. Version the labels and record a reason when correcting them; retain prior measured evidence for meaningful comparisons. Do not remove unsupported operations to increase scores. Hashes establish reproducibility, not label completeness or external adjudication.

## Metrics

- **Discovery precision** = matched semantic predictions / all semantic predictions. **Recall** = matched gold operations / all gold operations. Unmatched predictions are false positives. Missing operations are false negatives. Blocked findings count as discovered, and are also reported separately.
- **Runnable precision/recall** use only `candidate` findings. Blocked and missing operations stay in the recall denominator. Counts of raw and duplicate emissions remain visible. Reports provide per-project counts and micro-averaged totals.
- **Input contract correctness** is the fraction of matched operations whose property set, required set and all reference payload probes agree. Representative selection is deterministic: runnable first, then full form/workflow before button, then the contract with fewest required inputs, then ID. The report also gives runnable-only correctness, all-gold schema coverage, and individual probe agreement. Missing schemas never count as correct. Probes include accepted inputs, missing required inputs, optional values, wrong types, unknown fields, enums, constants, string and array boundaries, and nested lesson fields. The 21-lesson positive example checks that the executor's row bound (100) is not a hidden restriction on realistic inputs. Password equality, asynchronous uniqueness and other context rules are documented runtime rules rather than claimed JSON Schema equivalence.
- **Schema validity** separately checks generated input/output documents against Ajv's JSON Schema meta-schema. Return conformance checks the actual `ui-dispatched`/URL envelope. Valid syntax and envelope conformance do not prove faithful inputs or completed business effects. Domain service response schemas are not used as tool outputs in this prototype.
- **Execution success** = verified business outcomes / attempted runnable operations. **End-to-end coverage** = verified outcomes / all gold operations. Every runnable match gets an attempt with the gold arguments, even if its input schema is incorrect. Missing/blocked operations are unavailable, never counted as success. Setup failures are infrastructure errors, reported separately; they must be fixed before a complete measurement. One positive scenario per operation is measured; exhaustive validation, branch coverage and live-backend integration are not claimed.

Contracts are scored after `refineManifest` has read run-time option lists (for example API-loaded categories) from the isolated running app. Execution uses the actual generated plan, browser adapter and official MCP SDK client/server over in-memory transport. Browser contexts are fresh. Approvals exist only in memory for this isolated experiment. No manifest, selector, argument or UI plan is patched to make an action pass. Older apps retain their original fake backends; newer apps use deterministic intercepted API fixtures. Auth setup uses the original public login form or documented stored JWT bootstrap. Backend fixtures cannot validate real backend correctness. Unknown mutations and external requests are denied by the base isolation harness. Oracles check stored fields, exact request values, token changes, navigation and restored/rendered data instead of treating `ui-dispatched` as proof.

## Reproduce and gate

```sh
npm ci
npm run samples:setup
npm exec playwright install chromium
npm run test:eval
npm run benchmark
npm run release:check
```

`benchmark` writes [the report](../artifacts/evaluation/REPORT.md) and [per-action JSON evidence](../artifacts/evaluation/latest.json). Low compiler scores do not cause the measurement command to fail. Invalid labels, source changes and harness errors are not silently scored as successful measurements. Synthetic secrets are redacted in saved runtime evidence and schema payload probes.

`release:check` rejects missing/stale/static-only results and requires all 34 operations discovered, runnable, schema-correct and successfully executed, with zero false positives. This conservative comprehensive-support criterion intentionally blocks publication while known gaps remain. It is a separate command from regression verification and is included in `prepublishOnly`. `private: true` is also retained. An intentionally narrower future alpha needs an explicit versioned support policy; report whole-corpus recall alongside supported-subset scores.

The harness is excluded from the npm payload. The compiler itself is unchanged during this measurement. Future improvements should rerun these same labels, and generalization claims need independently adjudicated labels plus previously unseen projects.

## Independent holdout labels

[holdout/](holdout) holds operation labels written by annotators who had not seen the compiler, for two projects it was not developed against (revisions are in the top-level README). `tooling/score-labels.ts` reports discovery and input-contract agreement against them. It is a static check: it does not execute operations and applies the same probe set as the main benchmark. Annotator labels are used as written, except that `additionalProperties: false` and an empty `required` list are added when absent so unknown-property probes are meaningful.

The two `independent-app*` folders are complete source trees and checks authored by agents that had not seen the compiler. To run one: symlink a toolchain `node_modules` (Angular 22 + Material) into it, start `ng serve` on the port named in its `validate.mjs`, then `tsx tooling/run-independent.ts <folder> <routes-entry> <base-url>`. They are excluded from the root TypeScript project.

## Injection benchmark

`injection/generate.mjs` writes standalone components plus `truth.json` and `decoys.json` for 29 idioms (independent author). `tooling/score-injection.ts <workdir> <count> <seeds...>` scores the static compiler; `tooling/run-injection.ts <workdir> <toolchain node_modules> <node> <count> <seeds...>` copies `injection/host` (an Angular shell whose routes are the generated routes), serves it, probes every runnable capability, and scores static against probed contracts. Use seeds you have not tuned against for any reported number; `PROBE_BUDGET` and `PROBE_POOL` bound the probing cost.

## Scorer correction (version 2)

The scorer now evaluates candidate payloads against the full authored gold schema. A length boundary can also violate a pattern or format, so a hardcoded expectation for the isolated constraint is unsafe. Non-email regex fields receive generic pattern candidates; email candidates are restricted to email schemas. Standard JSON Schema formats use pinned `ajv-formats` validation, and numeric enums are tested with an unknown numeric value. Invalid gold representative inputs still fail explicitly.

The original five-project labels are unchanged by this scorer correction. Historical synthetic scores used version 1 and should not be compared directly to version 2. `tooling/rescore-injection.ts` rescores the same generated sources and captured probe reports after checking compiler and generator hashes. Original and corrected scores are retained separately; a scoring correction is not a compiler improvement.
