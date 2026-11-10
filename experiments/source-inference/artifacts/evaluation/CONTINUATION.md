# Continuation after Claude's changes

The existing implementation was retained. This iteration focused on making runtime inference and its evaluation more dependable.

- Boundary learning starts from an accepted value, handles narrow string ranges, and publishes no budget-truncated maximum or minimum. Unknown formats and continuous numeric bounds remain unresolved instead of being guessed.
- Membership checks require the baseline operation's effect signatures. Validation requests or audit writes alone do not establish that the business operation was reached.
- Idempotent edit controls do not acquire required-true constraints because an unchanged selection produces no event.
- UI-state observations compare before dispatch on the active route. A route load or a no-op is not reported as an action changing state.
- Native form POSTs are intercepted and observed along with fetch/XHR; external assets and WebSockets are blocked in probe contexts. Manifest observations retain HTTP metadata without raw request bodies.
- Scorer version 2 handles non-email patterns, combined constraints, standard formats, and typed numeric enums. Gold representative inputs must remain valid. Scoring corrections are separate from compiler improvements.

## Verification

- Five public projects: 34/34 operation effects verified, with all discovery and schema checks passing under scorer v2. Labels retain the source corrections recorded by Claude; this iteration did not change the ground-truth labels.
- 51 compiler/probe unit tests, 6 browser probe integration tests, 16 browser/protocol tests, and 9 evaluator tests passed (82 total).
- Type checking, package extraction/CLI checks, and the original-corpus release gate passed. Upstream application sources remain unchanged. No publication performed; the package remains private.

## Fresh synthetic instances, seed 2041

This seed was generated after the probe changes. It is a first-pass test on new instances of previously developed idioms, not an unseen-project accuracy estimate. Runtime observations were captured once; they were then rescored after fixing evaluator defects, without changing compiler code or generated labels.

| Metric | Static | After probing |
|---|---:|---:|
| Discovery | 29/31 (93.5%) | 29/31 (93.5%) |
| Strict input contracts / discovered | 13/29 (44.8%) | 14/29 (48.3%) |
| Contracts allowing name/type normalization | 18/29 (62.1%) | 19/29 (65.5%) |

One of 13 decoys was reported as a business operation. Thirteen raw runnable emissions did not yield a usable membership oracle; seven contracts received membership probes. No live-backend execution-success claim is made for this generated corpus. Finite payload probes are not formal schema equivalence, and some generator labels encode stricter types than the authored runtime guards.

The original 34/34 result establishes the tested development scope. The fresh-instance results still show substantial generalization gaps; a passing original-corpus gate does not establish readiness for a general public release.

- [Current original-corpus report](REPORT.md)
- [Corrected seed report](continuation-injection.json)
- [Original v1 seed scoring](continuation-injection-v1.json)
- [Captured per-capability probe observations](continuation-probes-s2041.json)

To repeat the original corpus: `npm run benchmark`. To rescore the captured seed in the source workspace: `node_modules/.bin/node --import tsx tooling/rescore-injection.ts artifacts/evaluation/continuation-injection-v1.json .cache/continuation-injection artifacts/evaluation/continuation-injection.json`. The generator, seed, count, budget, source hashes and scorer version are recorded in the JSON evidence.

## Subsequent source/schema remediation

The earlier scores above remain historical measurements. After the additional source inference and runtime fixes, the same seed2041 development instances now have 31/31 discovered/runnable operations, 24/31 strict contracts, 31/31 contracts under the previously defined parameter-name/integer normalization, and 0/13 decoy hits. This is a static regression measurement, not an execution-success or untouched-project estimate. Exact mismatches and final source hashes are retained in [remediated-synthetic-s2041.json](remediated-synthetic-s2041.json).

The remaining strict differences are explicit source names and integer abstractions. They are not silently relabelled. Readonly choice sets, guarded/trimmed inputs, query-result links, typed store factories, forwarded child controls, scoped row actions, counters and keyboard commits now have dedicated source and browser regressions. Review also added checks for mutable option aliases, incomplete enums, validator parameter rebinding, duplicate blur dispatch and falsely inferred query results.

Fresh source-frozen public-project evaluation is recorded separately in [fresh/REPORT.md](fresh/REPORT.md). Its first-pass failures remain in [fresh-baselines](fresh-baselines) and the original evaluation directories. The package remains private; no publication occurred.

The final full-corpus rerun also caught a refinement compatibility bug: an existing Material field explicitly promised visible labels, but new option refinement replaced them with internal codes. That failed measurement is preserved in [original-refinement-regression.json](original-refinement-regression.json). Refinement now honors the declared label contract while retaining raw IDs for ARIA selects. Regression tests cover both forms and duplicate-label refusal; the corrected original measurement is [REPORT.md](REPORT.md).
