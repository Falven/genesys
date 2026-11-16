# 15: Replace Workers and recover from source failures

**What to build:** Real source edits produce the correct replacement while bad candidates preserve the current Worker and later edits recover.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: W01, W02, B06, L01. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Build/start replacement while real native work continues on the current Worker; Temporal remains live and each generation resolves its matching build.
- [x] Fail and repair initial generation/build and later candidate build/startup through real source/executable errors; watching remains usable.
- [x] Check relevant package inputs trigger rebuilding and generated output does not loop.
- [x] Repeat a bounded number of edits and failures to detect duplicate watchers/launches or stale generation selection; retain intentionally required Workers rather than assuming every replacement must retire them.
- [x] Provide a reusable two-generation fixture and source-edit synchronization for retirement checks.

## Comments

[15-development-replacement.test.ts](../../../e2e/15-development-replacement.test.ts) runs the packed CLI against a managed Temporal server. A Go symbol collision prevents initial registration generation. A missing Go linker symbol preserves the selected successful manifest. A compiled candidate that exits during startup cannot become ready. Later single-file edits recover while the original version remains available for a pinned Workflow and its native Activities.

A source edit and a `go.mod` edit produce distinct native versions. The results report each version, PID, and snapshot working directory. The test copies real generated registration into the watched project and observes an unchanged selection during a delayed native call. The watcher does not acknowledge ignored events. This bounded observation and the build count detect extra builds that start during the run. They cannot establish whether the watcher processed the generated-file event before the next edit. Six build attempts, four Worker launches, one server, and one attached CLI exercise repeated replacement and supervisor reuse. Owned processes exit on owner shutdown.

[development-worker.ts](../../../e2e/development-worker.ts) prepares the fixture, writes a new source version, and waits for its selected manifest and CLI launch. It also starts a probe after native deployment-version registration and supports a held Workflow whose release runs a fresh native Activity.

Provisional local evidence before the product retirement update. macOS arm64, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, gsys 0.0.0, Go 1.27.4, Go SDK 1.51.0, TypeScript Client 1.25.0, Temporal CLI 1.10.0 with Server 1.32.2 and UI 2.56.1.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 15-development-replacement
pnpm exec tsc -p tsconfig.json
```

The local case and type check passed. The macOS arm64 case also passed against product commit `2e61166` after its merge into the E2E integration branch, with the tool versions listed above. Linux and Windows were outside these runs. Retirement decisions are covered by tickets 17 and 18.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 15-development-replacement`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) after the runner review fixes. Generated-output coverage detects extra builds during the live scenario. Ignored events have no acknowledgement to observe.
