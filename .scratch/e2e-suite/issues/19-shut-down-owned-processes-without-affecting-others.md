# 19: Shut down owned processes without affecting others

**What to build:** Local interrupts and real child/server failures expose premature service shutdown, lost errors, or leaked and wrongly signaled processes.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: P01, P02, P03, C06, L01. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Run native work during first interrupt and observe Worker process-tree exit before managed Temporal stops; respect native settings without another product deadline.
- [x] Use an unresponsive owned child and a second interrupt to check forced owned-tree cleanup while unrelated sentinel processes/services survive.
- [x] Terminate a real Worker child or managed server to observe Genesys failure handling and original diagnostics.
- [x] Repeat bounded starts/stops to detect leaks; preserve evidence before test-runner cleanup. Provide reusable ownership/shutdown cases for platform-specific execution.

## Comments

Implemented [the POSIX shutdown cases](../../../e2e/19-owned-shutdown.test.ts) with a reusable [Go fixture](../../../e2e/fixtures/go-shutdown/). The cases use the installed CLI, native Temporal calls and real operating system processes.

- P01 and L01. Premature server shutdown would prevent the remote Activity from completing or make the service unavailable while an owned descendant remains. The Activity starts before the first SIGINT, observes the Go SDK stop channel, and returns the Worker PID after a release gate. Temporal history records that native result. A separate gate holds the descendant after the Worker exits. Temporal still answers a namespace RPC before the descendant is released. The runner repeats this sequence in the same project and checks for exactly one Temporal and Worker launch per session.
- P02. An unresponsive Worker and its descendant each acknowledge the first interrupt and stay alive. The second interrupt terminates both owned process groups. An independent HTTP process returns its original response before and after cleanup.
- P03 and C06. Separate cases kill the real Worker and the real Temporal process by their recorded PIDs after confirming OS parentage and live process identity. Both preserve the original SIGKILL and return CLI exit code 1. The Worker failure leaves Temporal serving until the owner requests shutdown. The server failure causes owned Worker shutdown. The independent HTTP process survives both.
- Every session checks that both owned groups have no live members and that the managed Temporal port refuses connections. The runner captures process identities and CLI diagnostics before emergency cleanup if a case fails.

Four cases covering five real sessions passed on macOS 27.2.1 arm64. The toolchain was Go 1.27.4, Go SDK 1.51.0, Temporal CLI 1.10.0 with Server 1.32.2 and UI 2.56.1, Temporal TypeScript Client 1.25.0, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, and packed gsys 0.0.0. The cases passed at E2E baseline `84d9c2a` and in a detached preview with product revision `2393b91`. A targeted forced-shutdown run on the preview also confirmed native process exit and sentinel survival. The preview CLI returned 1 and reported that the POSIX ownership anchors disconnected without confirmed completion. The forced case checks process and service cleanup without requiring a specific CLI exit code. Final execution on the integrated product is pending.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 19-owned-shutdown
pnpm exec tsc --noEmit
pnpm exec oxlint e2e/19-owned-shutdown.test.ts
pnpm exec oxfmt --check e2e/19-owned-shutdown.test.ts
gofmt -l e2e/fixtures/go-shutdown
git diff --check
```

The Go SDK stop timeout is 90 seconds. The checks use native progress and release gates to verify the interval they exercise. Linux and Windows execution are unverified. Ticket [22](22-verify-macos-and-linux-package-and-process-boundaries.md) can run this suite directly. Ticket [23](23-verify-windows-package-launch-and-shutdown-boundaries.md) can copy the Go fixture with the native example's `go.mod` and `go.sum`, then use a Windows console driver and native process observation. Set `GENESYS_E2E_SHUTDOWN_DIR` to an existing directory outside the watched project and `GENESYS_E2E_SHUTDOWN_MODE` to `unresponsive` for the forced case.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 19-owned-shutdown`. All four cases passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) and Debian Linux arm64 in local Docker with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with reviewed cleanup. The forced case verifies owned process exit and unrelated service survival without prescribing supervisor status on abrupt loss of ownership confirmation.
