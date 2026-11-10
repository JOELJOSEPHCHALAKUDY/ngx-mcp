# Ground-truth evaluation

Measured 2026-11-09T21:47:23.141Z. Ground truth SHA-256: `78f604b90ad9ccd6f6201924b43fc89db239fae286fa11b4f84607d11a296405`.

Provisional source-reviewed development corpus; same agent authored labels and implemented the compiler. No independent adjudication or held-out accuracy claim.

| Project | Gold operations | Discovered | Runnable | Correct input contracts / matched | Execution passed / attempted | Verified / all gold |
|---|---:|---:|---:|---:|---:|---:|
| user-crud | 3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| signup | 11 | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 |
| forms-course | 3 | 3/3 | 3/3 | 2/3 | 2/3 | 2/3 |
| course-crud | 5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| realworld | 12 | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 |

- Discovery precision: **100.0%** (34 TP, 0 FP); recall: **100.0%**. Blocked findings count as discovered only.
- Runnable precision: **100.0%**; runnable recall: **100.0%**.
- Input contract correctness: **97.1%** (33/34 matched actions); probe agreement **98.6%** (498/505).
- Input/output schema documents are meta-schema valid: 34/34 and 34/34. Successful tool-return schema conformance: 33/33.
- Execution success: **97.1%** (33/34 attempted); verified end-to-end coverage: **97.1%** (33/34 gold operations).
- Blocked: 0; missing: 0; infrastructure errors: 0.
- Raw emissions: 70, including 36 duplicate route/template representations.
- Comprehensive-support release gate: **FAIL**.

## Failures and gaps

- **forms-course.save-draft**: runnable; schema fails; execution failed. {"content":[{"type":"text","text":"data/category must be equal to one of the allowed values"}],"isError":true} Failed checks: valid representative input, at minLength title, at maxLength title, enum category=Beginner, enum category=Advanced, optional releasedAt accepted, at minLength longDescription

## Limits

- Same-agent source review on development samples; no independent adjudication or holdout estimate.
- Semantic operation precision/recall merges duplicate bindings and reusable route variants. All blocked/missing operations remain in recall denominator.
- Execution tests one positive scenario for every runnable operation; does not exhaust branches, route variants, auth roles, negative cases, or real backend integration.
- HTTP backends are deterministic local fixtures; older examples use their original fake backend. No production API or account used.
- Schema score is finite input contract and probe conformance, not proof of equivalence. Output measures schema validity and successful return conformance, not domain-result schemas.
- Benchmark-only in-memory approvals allow every runnable match; these are not distribution approvals.

Full per-action evidence, source snapshots, schemas checks, probes and execution failures: [latest.json](latest.json).
