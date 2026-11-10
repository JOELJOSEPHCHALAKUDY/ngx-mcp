# Notes Manager fourth holdout

This app was selected after the generic bridge had been developed on other projects. Its labels and complete tracked-source inventory were frozen before running its own Angular compiler or the integration. There are no source/dependency overlays. The public MIT project is dplocki/angular-notes-manager at `f1aa7eb02e2dcee35be7684d7aebba647083fd98`. This historical unchanged checkout has coherent Angular20.0.2, CLI20.0.1 and TypeScript5.8.3 lock versions; HEAD had CLI21/core20 dependency skew.

`FREEZE.sha256` covers the source-authored labels, inventory and source manifest. `labels.json` defines seven business operations, eight positive cases and four boundaries. All executions use synthetic localStorage notes; the project has no backend or account. The reference runner uses DOM interactions. The MCP runner maps the frozen operations to generic tools using source-authored selectors, the exact current generated instance ID and explicit authored events. Neither runner uses Angular debug APIs or app component/service mutation.

The original production app passes 9/12 frozen reference cases. Edit, empty-text and long-title cases expose stale list titles/dirty marks after in-place note mutation in the original app. Those frozen failures remain visible, and must not be counted as integration regressions. The textarea values and saved-note persistence behave as recorded in the detailed snapshots. Source also shows that saving a newly created note does not insert it into persistent storage; no new-note persistence success is claimed.

Deletion invokes the real browser confirm. The runner records an independent external UI/human accept or dismiss step. Such outcomes are conditional on that step and are not unattended MCP confirmation successes.

From the compiler project root, prepare the unmodified source:

```sh
git clone https://github.com/dplocki/angular-notes-manager test-apps/fresh-notes-manager
git -C test-apps/fresh-notes-manager checkout --detach f1aa7eb02e2dcee35be7684d7aebba647083fd98
(cd test-apps/fresh-notes-manager && npm ci --ignore-scripts --no-audit --no-fund)
node_modules/.bin/node evaluation/integration-holdout/notes-manager/reference.mjs
node_modules/.bin/node --import tsx evaluation/integration-holdout/notes-manager/mcp-runtime.mts
```

`HOLDOUT_SOURCE_DIR` can point to another checkout. `COMPILER_PROJECT_ROOT` defaults to the current working directory. The reference starts a local production server on4375 (or `HOLDOUT_BASE_URL` uses an already running server). The integration runner stages a new temporary copy, delegates its production build to the project's own Angular CLI, serves it on4376, and connects the official MCP SDK client/server over the official in-memory transport. `HOLDOUT_REFERENCE_OUT` and `HOLDOUT_MCP_OUT` choose new report paths; preserve the first-pass reports when replaying. The integration runner records the full source digest before/after and rejects validity if either the shared compiler source or the pinned original source changes during execution.

The fourth project's first integration run occurred only after the shared runtime freeze signal. No generated contract or integrated build was inspected while authoring these labels.

## Preserved first integration pass

The untouched first integration pass failed during template analysis, before staging, build or MCP execution. `mcp-first-pass.json` records zero executed cases out of12 with the original error, unchanged compiler/source checks and full digests. Angular20's actual TemplateTypeChecker reports the three shared `buttonTemplate` references with empty source URLs and offsets relative to the evaluated template string. The bridge incorrectly interprets them as offsets into the full TypeScript file and refuses the opening tag. The directly written Save template maps correctly. `post-first-pass-template-spans.json` records this later diagnostic without changing baseline outcomes.

`first-pass-provenance.json` records all compiler source-file hashes, evaluator hashes and the canonical `metrics.treeDigest('src')`. The frozen first-pass runner used an absolute input path to that helper, whose hash includes paths; its internally equal before/after digest is retained verbatim in the baseline, and the canonical relative-path digest is provided separately. No source, dependency, label or generated-manifest patches were made. This is a demonstrated project coverage failure, not a runtime business success/failure measurement.


## Remediated second pass

The generic compiler now instruments Ngtsc evaluated templates using their actual template-relative coordinates. Each component receives its own escaped template literal in the staged copy; shared/imported constants remain intact. Source metadata explicitly records evaluated-template mapping, template-expression location and template-content SHA. Real Angular tests cover local/shared/imported no-substitution constants, quotes, newlines, backslashes, backticks, repeated views, separate directive scopes and actual AOT emission. The focused compiler and staging tests pass7/7; TypeScript checks pass.

`mcp-remediated-second-pass.json` is explicitly development-after-fix evidence. The app's own Angular20.0.2 production CLI build passed and the official MCP SDK executed all12 cases. It passes9/12 frozen checks, including all9 cases that pass the native reference. The final DOM/localStorage snapshots match the native reference in12/12 cases; there are no additional integration failures. The same three upstream display failures remain. Native confirm accepts/dismissals remain separately recorded external human/UI steps.

Both source integrity checks pass. The unchanged canonical compiler tree digest for this second run is `cf1b680d88e83393b14763e6ea90f5408d2524ce4215cad120272d5abd67a29a`. Full source/evaluator hashes are in `second-pass-provenance.json`. The first-pass evaluator was preserved verbatim as `mcp-runtime.first-pass.mts`; the current runner defaults to a separate second-pass output and refuses to overwrite existing evidence. This project was exposed during remediation and cannot be counted as another untouched first-pass success.

## Final current-source replay

`mcp-current.json` replays the unchanged12 cases after the final shared source freeze. The own-project production AOT build passes. Official SDK MCP calls execute12/12 cases;9/12 frozen checks pass, with exactly the same three upstream display failures. All12 final DOM/localStorage snapshots equal their independent native reference snapshots, and there are no additional integration failures. External confirm decisions remain explicitly recorded human/UI steps. This is current-source replay evidence after development exposure, not a replacement untouched holdout result.

The canonical compiler tree digest is `3f4d6bcf4b37cf914377a012907a1d69e41df81a6b296adbeea6e99518eb7e8d` before and after this run. Source/evaluator hashes and exact native snapshot parity are recorded in `current-provenance.json`. Both earlier reports and their exact evaluator snapshots remain preserved; pinned app sources and frozen labels remain unchanged. Browser and owned server are closed.

To replay to a new filename without overwriting baseline/current evidence:

```sh
HOLDOUT_RUN_KIND=final-current-source-replay HOLDOUT_MCP_OUT=evaluation/integration-holdout/notes-manager/mcp-replay.json node_modules/.bin/node --import tsx evaluation/integration-holdout/notes-manager/mcp-runtime.mts
```

## Replay after archiving the earlier approach

The earlier source-inference code is outside the active package. The current runner imports the Node-only `evaluation/digest.mjs`; its pre-archive bytes remain in `mcp-runtime.pre-archive.mts`. The earlier integrity sidecar and checker are preserved as `current-integrity.pre-archive.json` and `check.pre-archive.mjs`. Historical reports retain their actual source/evaluator hashes.

After a structural source change, replay to new filenames and capture provenance from that execution:

```sh
HOLDOUT_RUN_KIND=post-archive-current-source HOLDOUT_MCP_OUT=evaluation/integration-holdout/notes-manager/mcp-my-replay.json node_modules/.bin/node --import tsx evaluation/integration-holdout/notes-manager/mcp-runtime.mts
node_modules/.bin/node evaluation/integration-holdout/notes-manager/capture-current.mjs --report mcp-my-replay.json --provenance my-replay-provenance.json
node_modules/.bin/node evaluation/integration-holdout/notes-manager/check.mjs
```

Set `HOLDOUT_SOURCE_DIR` for all commands if the pinned source checkout is outside `test-apps/fresh-notes-manager`. The execution command retains an exit status of1 for the three native-upstream frozen failures; inspect its report before capture. The capture command requires all12 cases executed, the same9 native-passing outcomes, exact12/12 native snapshots, unchanged original app/frozen labels, and current compiler/evaluator hashes. It refuses stale reports and existing provenance filenames. The final checker additionally validates the recorded MCP calls and explicit external confirmation decisions. These remain development replays, not new untouched holdout successes.


The completed post-archive replay is [mcp-post-archive.json](mcp-post-archive.json), with [execution provenance](post-archive-provenance.json) and the current integrity sidecar. Its own-project production build passes; all12 native DOM/storage snapshots match, all9 native-passing frozen checks pass, and the same3 upstream display failures remain. The4 confirmation decisions remain explicitly external UI/human steps. The current canonical compiler digest is `83d149f7c4134cc17114bbb6b7dc27209ca3847bf012c1e1c5d7b6c5f29fb8ff`. The strict current-source checker passes; all earlier reports and frozen app inputs are unchanged.
