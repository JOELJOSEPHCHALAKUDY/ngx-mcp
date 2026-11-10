# Independent UI reference validation

14/14 frozen operations passed against the unmodified pinned upstream UI on 2026-11-09. The tests import only Node built-ins and Playwright, with no compiler, capabilities or generated-runtime imports. Labels and source hashes remained frozen.

Every check starts with a fresh browser context. Initial state comes from normal app boot/static local assets; setup and actions use only DOM clicks, typing or actual pointer drags. No handler/store mutation is called directly. All requests outside the local app origin are aborted; no account, backend or payment is contacted. Oracles read rendered DOM and read-only Angular dev state; Modern Store also reads localStorage.

Run from this directory with a compatible Node runtime:

```sh
/path/to/root/node_modules/.bin/node checks.mjs http://127.0.0.1:4332 /tmp/jira-clone-reference-results.json
```

`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` overrides the default root Playwright module location. Source servers currently run from `/tmp/fresh-jira-clone`; commands are in prerequisites.md. Tests can target any equivalent unmodified-source local port by the first argument. The output path is the second argument.

Jira checks include issue creation/deletion, field edits, rich text, assignee/reporter changes, comment addition, project metadata, reload reset, and both drag/drop variants using actual mouse down/move/up. Cross-column drag confirms the source implementation restores the moved issue old listPosition on its final upsert. No synthetic CDK event or direct drop-handler invocation was used.
