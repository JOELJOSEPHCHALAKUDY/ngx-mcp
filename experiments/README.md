# Archived experiments

The main project uses the compiler-to-runtime integration in [`src/`](../src/). Its setup is in the [main README](../README.md).

[`source-inference/`](source-inference/README.md) preserves the earlier static inference, bounded probing, certification, reviewed-manifest, and WebMCP prototype. It has its own private package, tests, source-reviewed labels, sample setup, reports, and historical failures. It is excluded from the main npm package, default tests, and release gates.

Run its commands explicitly from that directory, or use:

```sh
npm --prefix experiments/source-inference ci
npm --prefix experiments/source-inference test
```

The shared Angular test dependency installation stays at `samples/toolchains/course-crud/`; the archive links to it. Fetched public application checkouts stay outside the npm payload.
