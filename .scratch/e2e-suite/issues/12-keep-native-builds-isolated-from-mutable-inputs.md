# 12: Keep native builds isolated from mutable inputs

**What to build:** A published Worker retains its original code and dependencies after source/input changes, while a new build captures the changes.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: B02, B03, B04, B05, B06. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Change source, dependency inputs and package settings between builds; execute each selected native artifact and identify its own implementation.
- [x] Check generated registration reproducibility under equivalent inputs without comparing UUIDs, absolute build paths, or native binary bytes.
- [x] Exercise allowed internal links and rejected escaping/stale-build links; native output and removed generated definitions must not capture old or mutable sources.
- [x] Inspect all necessary generated locations and provenance, including owned outputs outside the generated root. Environment evidence must not expose secret values.

## Comments

- 2026-11-16: `pnpm test:e2e 12-build-isolation` passed both cases on macOS
  27.2.1 arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  and packed `@genesys/cli` 0.0.0. The live case used Go 1.27.4, Temporal Go
  SDK 1.51.0, Temporal TypeScript Client 1.25.0, and Temporal CLI 1.10.0
  (Server 1.32.2). Run with Go, Temporal, npm, pnpm, and the repository Node
  version on `PATH`.
- The live case detects builds that capture newer authored inputs or reuse stale
  registration. After edits to the Activity, a linked Go module, and a `go.mod`
  replacement, the retained and latest Worker commands each returned their own
  source, dependency, and settings values. `Legacy` still ran on the retained
  Worker, and `Current` ran on the latest Worker. The snapshot excluded the
  copied-back generated file and removed `Legacy` from the new registration.
  Equivalent workspaces at different absolute paths produced matching bytes
  and provenance hashes for all three generated Go registration files. The
  recorded dependency link had a snapshot-relative target.
- The manifest case detects missing output provenance and links to mutable or
  stale trees. A real npm build script removed a snapshot input and wrote a
  native output. Metadata recorded the removal and the native command, and the
  immutable manifest recorded file hashes for the output and registration
  beside the authored source. The manifest and metadata omitted the synthetic
  secret value, and metadata recorded an environment fingerprint. Escaping and
  earlier-build input links failed snapshotting. Native output links to authored
  files and an earlier build failed publication. The previous selector, output,
  and authored input survived all four failed builds.
- `pnpm exec tsc -p tsconfig.json`, `pnpm exec oxlint e2e/12-build-isolation.test.ts`,
  scoped formatting checks, and `git diff --check` passed. The npm case exercises
  publication and provenance. Native Worker execution was verified with Go on
  macOS. Linux and Windows runs, other runtime SDKs, and native binary
  reproducibility remain outside this evidence.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 12-build-isolation`. Both cases passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) against the merged snapshot and output rules.
