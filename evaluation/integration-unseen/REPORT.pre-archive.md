# Final integration evaluation

The strict native-parity and integrity gates pass on the final immutable v8 measurement. All native-working positive cases and all declared rejection/cancel/protocol cases pass through actual SDK MCP calls.

| Project | Native positives | Raw frozen positives | UI transport positives | UI negative/boundary cases |
| --- | ---: | ---: | ---: | ---: |
| finance | 13/13 | 10/13 | 13/13 | 10/10 |
| todo | 5/5 | 5/5 | 5/5 | 3/3 |
| shopping | 16/17 | 10/17 | 16/17 | 8/8 |
| Total | 34/35 | 25/35 | 34/35 | 21/21 |

Native references pass all 19 rejection/cancel cases; two further cases are MCP-only source/instance ambiguity boundaries. Both boundaries pass in raw and UI modes. Raw mode passes12/21 negative/boundary cases; unsupported transport/type refusals do not count as actual validator coverage. UI mode covers15 actual field/group validator cases, two source application refusals, two confirmation cancellations, and two protocol boundaries.

The sole positive source blocker is shopping/profile-avatar: the unchanged frozen one-pixel image causes the original Cropper workflow to produce a zero-sized canvas before any profile mutation. It remains in the 35-case denominator. The source-backed adjudication is [avatar-reference-adjudication.json](shopping/avatar-reference-adjudication.json).

The canonical source digest is `6405f73911b4aab10abe5b8e6e11668d764a7658d43ef1548097b8799cdab13f`. Compiler and evaluator before/after hashes match. Original commits, every frozen source file, licenses, dependency locks and labels remain unchanged. The runner stopped all six servers it started; [cleanup evidence](runs/final-v8-2026-11-10/cleanup.json) confirms no remaining listeners or recorded PIDs.

- [Measurement summary](runs/final-v8-2026-11-10/summary.json)
- [Finance reference](runs/final-v8-2026-11-10/finance/reference.json), [raw MCP](runs/final-v8-2026-11-10/finance/raw.json), [UI MCP](runs/final-v8-2026-11-10/finance/ui.json)
- [Todo reference](runs/final-v8-2026-11-10/todo/reference.json), [raw MCP](runs/final-v8-2026-11-10/todo/raw.json), [UI MCP](runs/final-v8-2026-11-10/todo/ui.json)
- [Shopping reference](runs/final-v8-2026-11-10/shopping/reference.json), [raw MCP](runs/final-v8-2026-11-10/shopping/raw.json), [UI MCP](runs/final-v8-2026-11-10/shopping/ui.json)
- [Preserved first failures and evaluator adjudications](historical-evidence.json)

The 23 evaluator/oracle regression tests pass. Both `check.mjs` and `check.mjs --require-parity` exit 0. See [reproduction commands](README.md).

These are representative execution scenarios after shared development fixes. They do not measure untouched-project accuracy, semantic discovery precision/recall, or exhaustive schema equivalence. UI transport explicitly records number-to-native-text and source identity-to-visible-label mappings, while frozen business arguments remain unchanged. Shopping uses an isolated synthetic API; other external requests are blocked. Finance/Todo state survives reload. No application source was fixed to improve a score, and nothing was published.
