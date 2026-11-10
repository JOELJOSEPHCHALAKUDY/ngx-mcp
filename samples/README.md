# Shared Angular test toolchain

The current integration tests use the pinned Angular/Material dependency installation in `toolchains/course-crud/`. Install it from the project root with:

```sh
npm run test:setup
```

This is a test dependency environment, not a sample application or a runtime dependency for consumers. Integration against an app uses that app's own Angular installation.

The [older source-inference experiment](../experiments/source-inference/README.md) links to the same toolchain. Its sample registry, fixture setup, and original five-project corpus now live in that experiment folder.
