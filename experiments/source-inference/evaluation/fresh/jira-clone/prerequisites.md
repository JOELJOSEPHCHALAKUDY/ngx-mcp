# Local execution prerequisites

The pinned upstream source is unchanged. Dependencies were installed in `/tmp/fresh-jira-clone/node_modules` using `npm ci --ignore-scripts --no-audit --no-fund`; the app directory uses a symlink to this isolated install. The lockfile was preserved byte-for-byte.

A compatible Node version is required: root compiler `node_modules/.bin/node` is v24, or `/tmp/fresh-angular-toolchain/node_modules/.bin/node` is v22.21.1. System Node20.12.0 is too old for Angular20. npm used was 10.5.0. Jira uses its upstream `.npmrc` (`legacy-peer-deps=true`). No overlay or dependency change was required.

Development build succeeded on 2026-11-09 using `NG_BUILD_MAX_WORKERS=2` and the Node22 runtime, outside the sandbox because both builds aborted with exit134 under sandbox worker restrictions. Use the exact build/serve command and port in labels.json project.runtime. The root Node24 runtime should also support these Angular20 projects.

No external backend, real account or payment is needed. Jira loads static auth/project JSON; shop hardcodes product data. Remote image/font requests can be stubbed locally. See the independent source labels for state persistence and mock operation limitations.
