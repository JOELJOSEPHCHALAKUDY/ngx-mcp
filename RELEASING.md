# Releasing ngx-mcp

The release candidate is `ngx-mcp@0.1.0-alpha.1`. Public prereleases use the npm **`alpha`** dist-tag; keep `publishConfig.tag` set to `alpha` and publish with `--tag alpha`. Publish only after the final candidate passes current verification and evidence gates. A prepared archive or successful local check does not mean npm publication has completed.

## Package boundary

| Shipped package | Source repository only |
| --- | --- |
| `ngx-mcp generate`, `serve` and authenticated HTTP `host` | Integration tests and evaluation runners |
| Compiler integration, browser runtime, native publisher and access controls | Pinned public-project inventories, labels and reports |
| Public library API and types | Fetched application source and shared test toolchains |
| README, production/release guides, license and attribution | `experiments/source-inference/`, the archived private prototype |

Consumers keep their own Angular compiler, forms packages, TypeScript and build system. Generated runtime code is compiled into the normal browser app. Node MCP requires a separate process/browser installation; native WebMCP requires a compatible browser and agent. The hosted service additionally requires owner-operated identity, isolated app-session provisioning, approval and audit services described in [PRODUCTION.md](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp/blob/main/PRODUCTION.md). A replacement Angular compiler is not distributed.

## Verify the final source

Use the supported Node version from `package.json`, then run from the repository root:

```sh
npm ci
npm run test:setup
npx playwright install chromium
WEBMCP_REQUIRE_NATIVE=1 \
  WEBMCP_NATIVE_REPORT=artifacts/webmcp/native-conformance.json \
  npm run verify
```

`verify` checks types, current regression tests and the extracted npm package. The package check tests the built CLI/library and generation in an independent consuming app, including preservation of its original source/configuration. `test:setup` installs the isolated Angular test toolchain.

With `WEBMCP_REQUIRE_NATIVE=1`, native API support is required instead of recording a skip. Use a browser exposing the supported actual WebMCP API. Its version, experimental flags and finite lifecycle scope are recorded in the report. Passing API tests does not establish ChatGPT/Claude product interoperability or certify a production deployment.

## Capture fresh production evidence

Follow [the fresh production cohort guide](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp/blob/main/evaluation/production-fresh/README.md) to fetch pinned projects, verify source hashes, reproduce unchanged native baselines and prepare the browser. After source and harness freeze, choose a new output directory for the matrix:

```sh
node_modules/.bin/node --import tsx evaluation/production-fresh/run.mjs \
  --out evaluation/production-fresh/runs/release-attempt-1
```

The matrix builds each fresh public app in `mcp`, `webmcp` and `both`. MCP uses the authenticated HTTP SDK transport; native paths use the actual browser API. `both` exercises both connections. It compares selected business postconditions with frozen source-authored native cases and separately checks authentication, policy denial, data scopes, approvals, session isolation and redacted audit. See the cohort guide for its exact denominators and limitations.

Reports must bind the current engine/harness, pinned sources, reviewed policy/build IDs and generated bundles. Retain first attempts and failures. A repaired project is development evidence, not an untouched holdout. Do not replace hashes or edit old outcomes to make stale evidence look current.

Run the current release gates after the completed matrix is recorded:

```sh
npm run release:check
```

`release:check` requires current native conformance, fresh production evidence and rejection tests for altered reports, source hashes, business payloads and build artifacts. `prepublishOnly` runs `verify` and `release:check`. A source, test harness, package metadata or lock change can invalidate evidence; use the gate's actual integrity checks and perform a real rerun when required. Do not infer a pass from an earlier report or this guide. The final result is the output of those commands on the exact release candidate.

Earlier Node-only three-project and fourth-project reports remain historical records for their original source snapshots. Their optional scripts/guides remain available under [integration-unseen](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp/blob/main/evaluation/integration-unseen/README.md) and [integration-holdout](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp/blob/main/evaluation/integration-holdout/notes-manager/README.md); they are not a substitute for the current production matrix. The old source-inference prototype has its own private historical checks and is outside the release path.

## Owner-run alpha publication

1. Use the [ngx-mcp repository](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp) alone. Keep the surrounding experiments workspace private. Review tracked files; exclude credentials, session state, dependency directories, fetched apps, generated output, caches and release archives.
2. Review the mode/default-profile explanation and the complete [production deployment contract](https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp/blob/main/PRODUCTION.md). Demonstrate owner-backed session validation, permission checks, trusted approval, durable audit, HTTPS/proxy configuration and account/tenant isolation for the deployment you intend to offer. Public demo-app tests do not verify a real identity-provider rollout.
3. Confirm the package name is `ngx-mcp`, the version is the intended unused prerelease (currently `0.1.0-alpha.1`), and repository/homepage/issue URLs identify this project. The package must be publishable (`private` absent or `false`), with `publishConfig` selecting the public npm registry, public access and the `alpha` tag. Update the lock when metadata changes. Review licenses/attribution and rerun current checks against the final metadata.
4. Inspect `artifacts/package-report.json` and the exact archive in `release/`. Confirm the production guide ships and archived experiments, apps, test data and secrets do not. Dependencies and browser downloads are installed separately from the archive.
5. Only after every required check passes, the package owner authenticates with the intended npm account, checks `npm whoami` and publishes with `npm publish --access public --tag alpha`. Never use the default `latest` tag for this alpha. Verify the registry version, dist-tag and archive integrity after publication; then smoke-test a clean installation with `npm install -D ngx-mcp@alpha` and `npx ngx-mcp --help`.

The release is complete only when npm confirms publication and the registry/install checks identify the intended version. For later alphas, choose a new immutable prerelease version, update the lock, capture fresh evidence when required and repeat these steps. Do not overwrite a published version or move `latest` as part of an alpha release.

Describe the release using its measured Angular versions, controls, transports and selected workflows. UI-dispatch success differs from backend business completion. Observable form schemas do not infer every domain constraint. Source-authored labels are not independently adjudicated universal ground truth, and finite parity is not arbitrary-project precision/recall or a security certification.
