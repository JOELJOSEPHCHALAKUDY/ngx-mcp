# Reproduce the pinned fresh fixtures

The public source revisions, upstream committed lock hashes, license evidence and exact project paths are recorded in [projects.json](projects.json). Each application source is verified against its original frozen source manifest before execution and after installation. No application is bundled in the compiler npm package.

From the compiler root, using its pinned Node24.15.0:

```sh
npm run samples:fresh
npm run samples:fresh -- --install
npm run samples:fresh -- --verify
npm run samples:fresh -- --dry-run
```

Use `--only modern-store`, `--only jira-clone` or `--only todomvc-angular21` to choose one fixture. `--verify` is read-only and does not install or fetch. Existing checkouts with a different revision, repository, tracked edits or source hashes are refused; the fetcher never resets user work. Installation uses `npm ci --ignore-scripts --no-audit --no-fund` and the original committed lock unchanged. Jira's upstream `.npmrc` supplies its legacy peer dependency setting.

Modern Store and Jira live in `test-apps/fresh-modern-store` and `test-apps/fresh-jira-clone`. TodoMVC is fetched into `test-apps/fresh-todomvc` using the pinned whole-repository Git commit with sparse paths `examples/angular/` and root `license.md`; its Angular app lives at `test-apps/fresh-todomvc/examples/angular`. That checkout remains reproducible after `/tmp` is cleaned.

Modern Store has an explicit README-only MIT declaration. Jira and TodoMVC have upstream MIT license files. The fetcher retains that evidence as supplied by the public source and does not invent or add license text. The separately retained legacy Angular4 experiment is not part of this modern fixture catalog.

Every `--install` run checks the original lock and source hashes again afterward. Source archives, labels, first-pass reports and their freeze files remain independent from dependency installs and later compiler evaluations. Use each fixture's documented project, route entry and port from `projects.json`; off-origin requests must remain blocked in evaluations.
