# 14: Reuse a supervisor without transferring ownership

**What to build:** A second CLI attaches to existing logs/status without rebuilding or restarting the owned session.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: S01, S02, S03. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a live owner and a secondary invocation; observe no duplicate build, watcher, Worker or Temporal startup.
- [x] Disconnect the secondary invocation and verify the owner and native work remain available.
- [x] Reject startup reconfiguration; test absent/unresponsive advisory endpoint records without a lock or one-supervisor guarantee.
- [x] Use the installed CLI and visible process/status effects rather than private reuse function calls.

## Comments

- 2026-11-16. `pnpm test:e2e 14-supervisor-reuse` passed on macOS
  27.2.1 arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  packed `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0, Temporal
  TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
  Local prerequisites include Go 1.26.0 or newer, Temporal CLI, and `ps`.
- S01 detects duplicate startup or source watching. The secondary printed the
  active Worker status and streamed the owner's failure after one malformed Go
  source edit. The owner logged one initial build, one failed build attempt,
  one Temporal launch, and one Worker launch. The secondary logged just the
  relayed build attempt and no process launches.
- S02 detects reconfiguration or shutdown by the secondary. A separate
  invocation with matching startup arguments exited 1 with the reconfiguration
  error. The attached secondary exited 0 after SIGINT. The same supervisor URL,
  manifest, Worker PID, and Temporal PID remained active, and a new native
  Workflow and Activity completed.
- S03 detects advisory records that prevent valid startup. The owner started
  with the record absent. After shutdown its real recorded endpoint refused
  connections. A new owner started with the stale record present and completed
  native work on a fresh service endpoint and namespace.
- Strict TypeScript checking, scoped formatting and lint checks, and
  `git diff --check` passed. This case covers sequential startup and
  noninteractive reuse on macOS. Concurrent startup and other OSes remain
  unverified. The existing product behavior passed the case on its first run.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 14-supervisor-reuse`. Passed in the selected run on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2).
