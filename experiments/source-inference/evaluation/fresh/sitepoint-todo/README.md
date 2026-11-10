# SitePoint Angular Todo fresh holdout

Source: https://github.com/sitepoint-editors/angular-todo-app at `7069b9be885821f2811f0fed8581a37e3b21f6c8`. MIT is declared in upstream package.json:4. Source archive and all upstream tracked-file SHA256 values are retained.

`labels.json`, `source-manifest.json`, `inventory.json`, and `prerequisites.json` were frozen in `FREEZE.sha256` before reading the compiler or generated manifests. The independent DOM reference then verified all four operations and two validation/state boundaries. No compiler or application patches were made.

`reference.mjs` runs only source-authored DOM interactions with `fixture.mjs`. `mcp-runtime.mts` uses the actual SDK MCP Client, linked InMemoryTransport, createMcpServer and browserAdapter. Every tool action goes through tools/list and tools/call. It reads the unchanged first-pass manifest. Frozen exact inputs, compiler-native payload retries, and an extra row-hover context retry remain separate in `first-pass-runtime-results.json`.

Result: 4/4 independent reference effects. First compiler pass: list missing; add/toggle/remove parent handlers blocked by forwarded-event resolution. Two leaf ui-state candidates exist, but 0 verified business effects through MCP. Full-object schema retries fail the legacy Angular4 debug API requirement; remove additionally fails waiting for a CSS-hidden button. An explicitly recorded first-row hover retry reaches the same debug API failure. These findings are legacy-app compatibility evidence.

Local source is `/private/tmp/fresh-sitepoint-todo`; evaluation working directory `/private/tmp/fresh-sitepoint-todo-evaluation`. The source is unmodified (`integrity-results.json`). Dependency resolution is pinned in this directory's generated package-lock.json; upstream provided no lock.

Run from angular-mcp-compiler with its pinned Node24:

```sh
node_modules/.bin/node --import tsx src/cli.ts --project /private/tmp/fresh-sitepoint-todo/src/tsconfig.app.json --routes app/app.module.ts#AppModule --out /private/tmp/fresh-sitepoint-todo-evaluation/first-pass-manifest.json
node_modules/.bin/node /private/tmp/fresh-sitepoint-todo-evaluation/reference.mjs
node_modules/.bin/node --import tsx /private/tmp/fresh-sitepoint-todo-evaluation/mcp-runtime.mts
```

Before running, install the retained lock with npm ci --ignore-scripts --legacy-peer-deps. Build the sample with `NODE_OPTIONS=--openssl-legacy-provider <pinned-node> node_modules/@angular/cli/bin/ng build --aot=false`, then serve dist using `python3 -m http.server 4341 --bind 127.0.0.1 --directory dist`. CLI1's dev server does not run under Node24 because http_parser was removed, so the unmodified static development build is used. The API is browser-intercepted; no backend/account is contacted.
