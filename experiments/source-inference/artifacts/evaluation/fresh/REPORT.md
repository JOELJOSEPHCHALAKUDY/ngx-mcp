# Public-project remediation measurement

Measured 2026-11-10T11:41:19.520Z. Compiler SHA-256: `6405f73911b4aab10abe5b8e6e11668d764a7658d43ef1548097b8799cdab13f`.

Reviewed local development-build workflows on three source-frozen public modern projects; after remediation these are development samples. This is not a new held-out accuracy estimate or production/backend guarantee.

| Project | Gold operations | Exact frozen business inputs + declared context | Generated-contract execution | Notes |
|---|---:|---:|---:|---|
| modern-store | 13 | 13/13 | 13/13 | Raw schemas 9/13; business schemas 11/13 |
| jira-clone | 14 | 14/14 | 14/14 | Raw schemas 14/14; business schemas 14/14 |
| todomvc-angular21 | 7 | 4/7 | 7/7 | 3 explicit argument mappings; 4 negative/boundary checks |

Tested-scope usability gate: **PASS**. No publication performed.

- modern-store: raw semantic precision 81.3%, raw emission precision 85.0% (17/20), scoped precision 100.0%, recall 100.0%. Schema scores retain frozen-label mismatches; 2 independently audited email approximations are explained separately.
- jira-clone: raw semantic precision 51.9%, raw emission precision 64.9% (24/37), scoped precision 100.0%, recall 100.0%. Schema scores retain frozen-label mismatches; 0 independently audited email approximations are explained separately.
- The Angular4 legacy test remains recorded: original UI 4/4, generated effects 0/4. It is unsupported.

- Original first-pass failures and frozen labels remain unchanged.
- Runtime context is declared separately and fixture setup uses original UI.
- Raw precision retains unlabelled transient UI predictions; scoped precision cites frozen inventory exclusions.
- The two audited email mismatches remain failures in raw schema scores.
- TodoMVC requires three documented mappings to use the generated tool schemas.
- HTTP-free/local fixture effects do not establish production API correctness.

Full schemas, payloads, mappings, exact contexts, effects, source/evaluator hashes and failure history: [latest.json](latest.json). Original frozen first-pass evidence is in [fresh-baselines](../fresh-baselines) and [evaluation/fresh](../../../evaluation/fresh).
