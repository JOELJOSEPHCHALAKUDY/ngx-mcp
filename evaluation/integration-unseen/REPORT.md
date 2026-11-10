# Final integration evaluation

The strict native-parity and integrity gates pass on a fresh post-archive measurement of the current compiler/runtime package. All native-working positive cases and all declared rejection/cancel/protocol cases pass through actual SDK MCP calls.

| Project | Native positives | Raw frozen positives | UI transport positives | UI negative/boundary cases |
| --- | ---: | ---: | ---: | ---: |
| finance | 13/13 | 10/13 | 13/13 | 10/10 |
| todo | 5/5 | 5/5 | 5/5 | 3/3 |
| shopping | 16/17 | 10/17 | 16/17 | 8/8 |
| Total | 34/35 | 25/35 | 34/35 | 21/21 |

Native references pass all 19 rejection/cancel cases; two further cases are MCP-only source/instance ambiguity boundaries. Both boundaries pass in raw and UI modes. Raw mode passes12/21 negative/boundary cases; unsupported transport/type refusals do not count as actual validator coverage. UI mode covers15 actual field/group validator cases, two source application refusals, two confirmation cancellations, and two protocol boundaries.

The sole positive source blocker is shopping/profile-avatar: the unchanged frozen one-pixel image causes the original Cropper workflow to produce a zero-sized canvas before any profile mutation. It remains in the 35-case denominator. The source-backed adjudication is [avatar-reference-adjudication.json](shopping/avatar-reference-adjudication.json).

The canonical source digest is `83d149f7c4134cc17114bbb6b7dc27209ca3847bf012c1e1c5d7b6c5f29fb8ff`. Compiler and evaluator before/after hashes match. Original commits, every frozen source file, licenses, dependency locks and labels remain unchanged. The runner stopped all six servers it started; [cleanup evidence](runs/post-archive-2026-11-10/cleanup.json) confirms no remaining listeners or recorded PIDs.

- [Measurement summary](runs/post-archive-2026-11-10/summary.json)
- [Finance reference](runs/post-archive-2026-11-10/finance/reference.json), [raw MCP](runs/post-archive-2026-11-10/finance/raw.json), [UI MCP](runs/post-archive-2026-11-10/finance/ui.json)
- [Todo reference](runs/post-archive-2026-11-10/todo/reference.json), [raw MCP](runs/post-archive-2026-11-10/todo/raw.json), [UI MCP](runs/post-archive-2026-11-10/todo/ui.json)
- [Shopping reference](runs/post-archive-2026-11-10/shopping/reference.json), [raw MCP](runs/post-archive-2026-11-10/shopping/raw.json), [UI MCP](runs/post-archive-2026-11-10/shopping/ui.json)
- [Pre-archive evaluation summary](REPORT.pre-archive.md) and [immutable prior v8 measurement](runs/final-v8-2026-11-10/summary.json)
- [Preserved first failures and evaluator adjudications](historical-evidence.json)

The earlier source-inference code was moved out of the active source tree before this replay. All three native/raw/UI matrices were executed again; historical report hashes were not retagged. The current digest helper is pinned as an evaluator input.

The 23 evaluator/oracle regression tests pass. Both `check.mjs` and `check.mjs --require-parity` exit 0. See [reproduction commands](README.md).

These are representative execution scenarios after shared development fixes. They do not measure untouched-project accuracy, semantic discovery precision/recall, or exhaustive schema equivalence. UI transport explicitly records number-to-native-text and source identity-to-visible-label mappings, while frozen business arguments remain unchanged. Shopping uses an isolated synthetic API; other external requests are blocked. Finance/Todo state survives reload. No application source was fixed to improve a score, and nothing was published.
