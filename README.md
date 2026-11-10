# ngx-mcp

**Let AI agents use your Angular app's real forms and buttons.**

ngx-mcp uses your app's installed Angular compiler to connect tools to live controls. Filling a field or submitting a form runs the app's existing validators, event handlers and API calls. You keep your Angular compiler and normal build process.

The generator writes a separate copy. Your original app stays unchanged.

> **Private alpha; not published on npm.** Start with synthetic data on a local or staging app. Production access controls require your application's backend integration; see [Production setup](PRODUCTION.md). Passing the test suite does not establish arbitrary-app compatibility or certify a deployment's security.

## Pick how agents connect

| Generate mode | Connection | What you run |
| --- | --- | --- |
| `mcp` (default) | An MCP client talks to a Node adapter, which drives a browser running your app | Generated Angular app + `ngx-mcp serve`, or an authenticated `ngx-mcp host` service |
| `webmcp` | A compatible browser agent calls tools registered inside the page | Generated Angular app; browser-native WebMCP support is required |
| `both` | Both connections use the same runtime and production policy | Generated app + a Node adapter when using the MCP connection |

WebMCP is experimental. Publishing a website does not automatically let ChatGPT or Claude connect to it. Those products need a supported connection path; browser API tests do not establish product interoperability.

## Try it locally

You need a supported Node version from [package.json](package.json), an Angular CLI app that already builds, and that app's dependencies installed. The generator uses the app's own Angular/TypeScript versions. Compatibility depends on the app and controls; the [evaluation guides](evaluation/production-fresh/README.md) record the measured scope.

### 1. Build this private preview

```sh
git clone https://github.com/JOELJOSEPHCHALAKUDY/ngx-mcp.git
cd ngx-mcp
npm ci
npx playwright install chromium
npm run build
```

This installs the source preview. The package has not been published on npm.

### 2. Generate a copy

From the `ngx-mcp` folder:

```sh
node dist/ngx-mcp.js generate \
  --project ../my-app/tsconfig.app.json \
  --out ../my-app-mcp \
  --mode mcp
```

`--out` must be a new folder outside your app. In a multi-app workspace, add `--target <angular-project-name>`. Use `--mode webmcp` or `--mode both` to choose the other paths.

### 3. Run that copy

```sh
cd ../my-app-mcp
npx ng serve --port 4200
```

### 4. Connect an MCP client

For `mcp` or `both`, add this to your client's MCP configuration:

```json
{
  "mcpServers": {
    "my-angular-app": {
      "command": "node",
      "args": [
        "/full/path/to/ngx-mcp/dist/ngx-mcp.js",
        "serve",
        "--base-url", "http://localhost:4200",
        "--headed"
      ]
    }
  }
}
```

Restart the client. A Chromium window opens; log into the app there if necessary. Ask the agent to list the available forms, then try a workflow using synthetic data. For `webmcp`, use a browser agent that supports the native API instead of this Node configuration.

The default `development` profile allows local experimentation without production approval controls. Its actions use the logged-in app session and can change real data. Choose the production profile before offering agent access to other people.

## What gets deployed?

```mermaid
flowchart TD
    A[Your Angular source + installed Angular compiler] --> G[ngx-mcp generate]
    G --> C[Separate copy: app + generated browser runtime]
    C --> B[Normal Angular production build]
    B --> D[dist: JavaScript, HTML and assets]
    D --> W[Your normal web hosting]
    W --> P[App + generated runtime run in a browser]
    P --> API[Your existing backend: permissions remain authoritative]
    P -. webmcp or both .-> N[Compatible browser agent]
    M[MCP client] --> S[Separate Node adapter or authenticated HTTP service]
    S -. mcp or both .-> P
```

The generated runtime becomes part of the app's normal browser bundle. The Node service is a separate process; it is not hidden inside `dist`. Hosting `dist` enables the selected browser runtime, but does not create a publicly reachable MCP endpoint.

## Production setup

The production profile requires a reviewed, exact-build policy and an owner-written `connectNgxMcpAccess()` module. It defaults to denying tool/data access, revalidates the app session, scopes reads and writes, requires trusted approval for mutations, and sends redacted events to your audit sink. The backend must implement session validation, permission checks, approval and audit storage.

Follow [PRODUCTION.md](PRODUCTION.md) for the review/generate/deploy workflow, a browser bootstrap contract, remote `serve` configuration and authenticated HTTP hosting. Existing apps deploy a new generated build through their normal pipeline. They do not replace Angular's compiler or expose the old production build retroactively.

## Tools

| Tool | Purpose |
| --- | --- |
| `angular_list_nodes` | List available forms, fields and actions |
| `angular_describe_node` | Describe a selected node; production values need separate read permission |
| `angular_read_model` | Read the permitted Angular model projection |
| `angular_fill`, `angular_submit`, `angular_activate` | Fill fields, submit forms and activate controls |
| `angular_form_*` | A typed tool for each available form |
| `angular_read_view` | Node adapter page view; production returns permitted metadata only |
| `angular_press_key`, `angular_upload_file` | Node adapter keyboard and upload operations |
| `angular_navigate` | Node adapter navigation in development; disabled in production |

Only allowed tools/nodes are exposed in production. A successful UI dispatch is not proof that a backend transaction completed; inspect the app's actual result. Browser-native publication currently covers the shared form/control tools, not all Node adapter conveniences.

## Commands

Run `node dist/ngx-mcp.js <command> --help` from this checkout. An installed package provides the shorter `ngx-mcp` command.

| Command/option | Meaning |
| --- | --- |
| `generate --project <tsconfig>` | Read the app with its own compiler and stage a new copy |
| `--out <new-dir>` | Output outside the original workspace |
| `--mode mcp\|webmcp\|both` | Choose connections; defaults to `mcp` |
| `--profile development\|production` | Choose access controls; defaults to `development` |
| `--policy <reviewed.json> --access-bootstrap <module.ts>` | Required for production; exact policy/build binding and trusted backend hooks |
| `--target <name>` | Select an Angular project in a multi-app workspace |
| `--build --configuration production` | Build the copy using the app's Angular CLI |
| `--compiler-only` | Skip additional runtime UI-library discovery |
| `serve --base-url <url> --headed` | Connect an MCP client to a running generated app |
| `serve --storage-state <file>` | Use operator-provided Playwright session state; treat the file as a credential |
| `serve --allow-origin <https-origin>` | Explicitly permit a remote production app |
| `serve --allow-network-origin <https-origin>` | Permit a remote app's required API/identity/resource origin; repeat as needed |
| `host --config <server-config.mjs>` | Start authenticated HTTP MCP with server-owned identity/session/audit configuration |

## Troubleshooting and limits

| Problem | Next step |
| --- | --- |
| Compiler/dependency error | Install the app's dependencies and confirm its original production build works. |
| Output already exists | Choose a new output folder. |
| No registry found | Serve the generated copy and check that its browser entry imports the runtime. |
| No native WebMCP tools | Check browser/agent support and selected generation mode. |
| Production catalog is empty | Check owner bootstrap, live session, origin/route policy and exact source IDs. |
| Production generation rejects `buildId` | Regenerate the review manifest with the same bootstrap, review changed IDs/behaviour, then update the policy. |
| A workflow dispatches but does not complete | Check native validation and the backend's result; tool acknowledgement alone is insufficient. |

Custom widgets and app-specific business semantics can need explicit integration. Generated form schemas describe observable UI input, not every backend rule. Browser tool controls supplement existing backend authorization and do not isolate an app from malicious scripts already running in its page.

## Development and release evidence

```sh
npm run test:setup
npm run verify
```

See [RELEASING.md](RELEASING.md) for native-browser and fresh-project release gates. [Production evaluation](evaluation/production-fresh/README.md) records pinned public projects and reproducible checks. Earlier reports remain historical evidence for their recorded source snapshots. The older prototype lives under [experiments/source-inference](experiments/source-inference/README.md) and is excluded from the package.

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for public sample attribution.
