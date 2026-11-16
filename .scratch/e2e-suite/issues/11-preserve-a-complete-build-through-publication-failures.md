# 11: Preserve a complete build through publication failures

**What to build:** Local build tests prove a failed or concurrent candidate cannot replace the current build with incomplete output.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: B01, B05. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Publish a working native build, then cause real analysis/generation/build failures and inspect the selected immutable manifest.
- [x] Run concurrent builds and observe only complete published selections; do not assert unsupported multi-file atomicity.
- [x] Execute the last successful selected artifact after a failed candidate and check candidate cleanup preserves authored source and other builds.
- [x] Check emitted output and metadata references are usable; reproduce publication failures through real filesystem conditions where reasonable before considering a case-local substitute.

## Comments

[The publication tests](../../../e2e/11-build-publication.test.ts) use the installed
`gsys` and the native Go example.

- Premature selection or overbroad cleanup would change the prior selector, leave
  candidate files, overwrite authored files, or remove a successful build. The
  test causes analysis, generation output, Go compile, and publication failures.
  For the publication failure, a directory with an authored sentinel obstructs
  the convenience metadata rename. After the failure, a native Temporal Client
  gets the original Activity result from the Worker launched by the selected
  immutable manifest.
- Concurrent publication could expose a partial selector or incomplete output.
  The test observes overlapping candidate directories and samples the selector
  while both CLI commands run. Every observed selector matches a complete
  manifest. Both successful command results lead to independently complete
  immutable manifests.
- Broken output references, mismatched provenance, or environment disclosure
  would fail the artifact checks. The tests follow selected manifests to native
  executables, generated Go imports, and per-build metadata. They check file
  hashes, native command and tool records, and absence of the supplied synthetic
  environment value. [Ticket 12](12-keep-native-builds-isolated-from-mutable-inputs.md)
  covers inputs removed by native tooling.

`pnpm test:e2e 11-build-publication` passed both cases on macOS 27.2.1 arm64.
Tools used were Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
`gsys` 0.0.0, Go 1.27.4, Go Temporal SDK 1.51.0, Temporal CLI 1.10.0 with
Server 1.32.2, and TypeScript Temporal client 1.25.0. Scoped TypeScript, lint,
and formatting checks passed.

The concurrent test makes assertions about the current selector and the
immutable paths it identifies. Sampling can miss a selection replaced between
reads. The filesystem failure covers publication preparation. Other platforms
and SDK build paths require separate execution evidence.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 11-build-publication`. Both cases passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2). The main-derived build kept the selected artifact through real failures and complete concurrent publication.
