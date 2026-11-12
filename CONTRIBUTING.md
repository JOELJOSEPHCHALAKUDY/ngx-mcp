# Contributing

Use a Node.js version supported by [package.json](package.json).

```sh
npm ci
npm run test:setup
npx playwright install chromium
npm run verify
```

`verify` checks TypeScript, runs the integration and evaluator tests, and tests the npm archive in a separate Angular app. Native WebMCP tests need a Chrome build with the required browser API; see [release checks](RELEASING.md).

Add a generic regression test for a bug fix. Keep application source, credentials, browser sessions, and temporary test data outside this repository. Public sample attribution is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

[Public-project evaluations](evaluation/production-fresh/README.md) describe the tested projects, scenarios, and limitations. Earlier experiments are archived under [experiments/source-inference](experiments/source-inference/README.md).
