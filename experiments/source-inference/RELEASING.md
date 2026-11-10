# Archived experiment: no publication

This directory is a private research package for the older source-inference approach. It is excluded from the main package's build and npm payload. Its `private: true` setting and failing `prepublishOnly` hook disable publication.

Use `npm --prefix experiments/source-inference run <script>` from the repository root to study or test it. `verify` checks this implementation; historical measurement gates are separate and reject stale results after the directory move. Preserve frozen labels, original failures, and previous reports when rerunning research measurements.

The exact pre-cleanup release document is retained at [provenance/before-layout/RELEASING.md](provenance/before-layout/RELEASING.md) for historical reference. Its commands are not instructions to release this archive.

For the current compiler-to-runtime integration's package contents and release process, read the [main release guide](../../RELEASING.md).
