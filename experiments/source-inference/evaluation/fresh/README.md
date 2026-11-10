# Fresh source-frozen compiler checks

Two public pinned Angular applications are evaluated against source-only labels frozen before compiler scoring. Each project folder contains `labels.json`, its freeze/source hashes, the independent `checks.mjs` source UI baseline, and a separate `compiler-checks.ts` generated-tool evaluation.

Run against the unmodified source dev servers:

```sh
node_modules/.bin/node --import tsx evaluation/fresh/modern-store/compiler-checks.ts http://127.0.0.1:4331
node_modules/.bin/node --import tsx evaluation/fresh/jira-clone/compiler-checks.ts http://127.0.0.1:4332
```

An optional third argument selects a result JSON path. The default is each project's `compiler-results.json`. The exact static compiler output is saved as `compiler-static-manifest.json`. Official `refineManifest` may discover complete source-bound live option maps before reviews; its fingerprint-updated result is saved as `compiler-manifest.json`, with both hashes and every changed field recorded. The harness never hand-patches either manifest.

`harness.ts` runs the official MCP SDK Client with InMemoryTransport, createMcpServer and browserAdapter. All 27 frozen operations stay in the denominator. Each operation gets an isolated browser context, original UI setup, exactly one generated-tool call, and independent effect assertions. External requests are aborted. No source handler/store mutation is invoked directly.

The frozen `validInput` object is copied without aliases, flattening, field dropping or argument shape changes. Declared route parameters may be extracted from the setup URL and added separately; `businessArgs`, `contextAugmentation` and final `transportArgs` are all reported. Explicit adapter context declared by a capability is validated separately: the frozen Jira Backlog fixture supplies the rendered CDK sourceStatus container, recorded under runtimeContext with its independent source. The source fixture issue id is read from the visible board before navigating the declared direct issue route. Context does not supply undeclared object/row/form tool inputs to make an incompatible schema work.

Results distinguish `success`, `missing`, `blocked`, `schema-rejected` and `failed`. Success requires the independent business oracle, not only a successful MCP response. Every report records source and evaluator hashes, source immutability checks, generated schemas, matched capabilities, tool result/errors, state evidence and blocked external origins. `compilerChangedDuringRun` flags measurements made while compiler implementation work was in progress.

Independent source-label limitations remain explicit: mock shop auth/order behavior, in-memory Jira persistence and drag position behavior, rich-text normalization, CDK event adaptation, and the email-format approximation documented in `modern-store/email-audit.md`.

Confirmation cases first verify an unconfirmed official MCP call refuses before opening an overlay or changing business state. A separately recorded, exact-capability host confirmation is then supplied for the authorized synthetic local fixture operation; it is never inserted into business payloads.
