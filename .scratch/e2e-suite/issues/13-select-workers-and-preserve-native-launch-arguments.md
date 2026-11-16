# 13: Select Workers and preserve native launch arguments

**What to build:** Local executions detect wrong Worker selection, changed arguments/cwd, unintended shell evaluation, or broken persistence forwarding.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: C01, C02, C03, C04, C05, C06. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use two native Worker programs to check default all-Worker behavior, repeated selectors, unknown names and arguments to unselected targets.
- [x] Capture application-observed argv/cwd from real native programs; test executable override replacement, first-colon parsing, empty strings, spaces, Unicode and shell metacharacters without shell execution.
- [x] Exercise forwarded server flags and separate invocation versus Worker package working directories without automatic connection rewriting.
- [x] Start/shut down/restart an explicitly persisted local session to expose database-path forwarding or cleanup defects. Verify default startup does not invent a database location.

## Comments

- 2026-11-16: `pnpm test:e2e 13-dev-launch` passed on macOS 27.2.1 arm64 against the packed `@genesys/cli` 0.0.0 from the integration worktree. The run used Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, Temporal TypeScript SDK 1.25.0, Temporal CLI 1.10.0 (Server 1.32.2), and the system `script` and `ps` utilities. Run on macOS or Linux with those tools on `PATH` and npm registry access for the fixture SDK.
- C01–C04: Both Worker programs served real Workflow calls under piped and pseudo-terminal invocations. Both used the authored service and environment while managed Temporal listened on another endpoint. Repeated selectors started each selected program once. A single selector started only its target. Unknown selectors and unselected argument targets produced stderr diagnostics without launching Workers. The current development session remains running after those diagnostics until interrupted. Workflow results captured the exact override and inferred arguments and native package cwd. The shell argument created no marker.
- C05: The default Temporal command contained only the native subcommand and forwarded flags. The explicit command received the relative SQLite filename verbatim. A Workflow completed before shutdown, the database survived in the invocation directory, and the restarted server returned that Workflow result. The retention probe covers Genesys argument forwarding and shutdown cleanup.
- C06 also exercises two operational failures. An occupied loopback address returns a nonzero result and starts no managed process. The original Temporal server still serves its unique namespace. An absent native Worker executable produces an ENOENT diagnostic and a nonzero exit after interrupt. No Worker starts, the owned Temporal listener closes, and the original server still serves its namespace. See [ticket 10](10-verify-discovery-boundaries-and-cli-failures.md) for general CLI errors.
- The case with both C06 failures passed against product commit `2e61166` after its merge into the E2E integration branch. The macOS arm64 run used the same Node, package manager, and Temporal versions listed above. Linux and Windows were outside this run.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 13-dev-launch`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with the review fixes. The case includes a real occupied endpoint and missing executable, proves the unrelated listener remains reachable, and checks the selected Worker launch.
