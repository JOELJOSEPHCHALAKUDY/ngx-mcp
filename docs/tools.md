# Tool and command reference

Tools describe the controls currently mounted in the browser. Discover their IDs before calling them, and discover them again after navigation or changes to the page.

## Tools

| Tool | Purpose |
| --- | --- |
| `angular_list_nodes` | List available forms, fields and actions |
| `angular_describe_node` | Describe a selected node; production values need separate read permission |
| `angular_read_model` | Read the permitted Angular model projection |
| `angular_fill`, `angular_submit`, `angular_activate` | Fill fields, submit forms and activate controls |
| `angular_drag` | Drag exact live pointer handles to an exact destination; production requires permission for both endpoints |
| `angular_form_*` | A typed tool for each available form |
| `angular_read_view` | Node adapter page view; production returns permitted metadata only |
| `angular_press_key`, `angular_upload_file` | Node adapter keyboard and upload operations |
| `angular_navigate` | Node adapter navigation in development; disabled in production |

For a large page, start discovery with `{kind: "form", visible: true, includeFields: false}` and describe the selected form to read its fields. Typed form tools are published only when their fields and one visible submit path are supported; use exact generic controls for multi-button forms. Discovery returns at most 100 nodes by default; follow `nextOffset` for more, and restart after a UI change. Descriptors identify the source of each label in `labelSource`; `single-control-context` marks nearby text from an unambiguous field container, rather than an explicit HTML label association.

Only allowed tools and nodes are exposed in production. A successful UI dispatch does not prove that a backend transaction completed; inspect the app's actual result. Browser-native publication covers the shared form and control tools.

- **Editing:** `angular_fill` accepts plain text for `contenteditable`. Use `angular_activate` with `event: "select-all"` on an editor before applying one of its original formatting commands. Runtime discovery observes Angular's public event registrations, so library controls without button roles can advertise their registered events, such as `mousedown`. Choose an event from the descriptor; no component method is called directly.
- **Uploads:** pass `{files: [{name, mimeType, base64}]}` to `angular_fill`. The limit is 512 KiB of decoded data, with up to 16 files when the input allows multiple files. File contents are excluded from discovery and model reads. A hidden input needs a visible associated label or an exact file-picker request observed during an activated UI action; that offer lasts 30 seconds and is consumed on upload.
- **Keyboard:** `angular_activate` with `event: "keyboard", key: "Enter"` dispatches key handlers and native Enter/Space activation on exact focusable controls. It does not provide browser shortcuts, text typing or Tab traversal. Inputs and editors also accept `event: "keydown", key: "Escape"` for dialog dismissal.
- **Navigation and frames:** full page navigation can interrupt an in-page tool response. Observe the destination and rediscover tools there. Same-origin iframe controls use their own documents; cross-origin frames stay outside the registry. Production permissions for a frame host do not grant access to its child controls.

The adapter stabilizes the app's injected Angular zone, then dispatches UI events outside it so original listeners retain their normal change detection and browser default-action timing. Browser restrictions, delegated nonsemantic controls, and custom widgets can still require an adapter.

## Commands

Run `npx ngx-mcp <command> --help` from the app or server folder where you installed the package. For example:

```sh
npx ngx-mcp serve --base-url http://localhost:4200 --headed
```

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
