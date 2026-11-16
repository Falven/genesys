# 23: Verify Windows package, launch and shutdown boundaries

**What to build:** Locally runnable Windows cases verify native paths, installed assets, console control and owned process-tree shutdown through the bundled Windows helper.

**Blocked by:** [19: Shut down owned processes without affecting others](19-shut-down-owned-processes-without-affecting-others.md), [Project definition 18: Package the complete CLI for supported platforms](../../project-definition/issues/18-package-the-complete-cli-for-supported-platforms.md) (resolved)

**Status:** ready-for-agent

**State:** open

Coverage groups: E03, K02, P01, P02, P03. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Activate the lifecycle cases on Windows hosts with the bundled helper from product ticket 18. A Windows startup error fails the cases.
- [ ] Reuse the packaging and lifecycle scenarios while checking Windows-specific command/path boundaries and real native console/process ownership.
- [ ] First interrupt follows native graceful behavior and second interrupt terminates only the owned tree; unrelated processes remain alive.
- [x] Select the Go lifecycle fixture for the Windows boundary. Record missing local tools or unavailable hosts without passing skips.

## Comments

Added `pnpm test:e2e 23-windows-boundaries` for Windows 10 or Windows Server 2016
and later with x64 or arm64 Node. The selected cases require npm, pnpm, Go 1.26.0
or later, the native Temporal CLI, permission to run the unsigned helper, and
compatible nested Job Object assignment. Product ticket 18 shipped the helper.

The cases run the npm-installed CLI and verify helper architecture selection,
native Worker arguments and paths, and the managed server's relative database
path. The packaged helper gives the CLI a private console and sends real Ctrl-C
events. The cases observe native Activity completion before the Worker tree
exits, force termination after a second Ctrl-C, real managed Temporal failure,
and an unrelated HTTP service surviving the session.

Local validation used macOS 27.2.1 arm64, Node v26.13.1, npm 11.20.0, pnpm 12.17.0,
Vitest 5.1.0, Go 1.27.4, and Temporal CLI 1.10.0 with Server 1.32.2.
`pnpm exec tsc -p tsconfig.json` passed. `pnpm test:e2e 19-owned-shutdown` passed
all four POSIX cases, and `pnpm test:e2e 01-installed-go` passed the installed CLI
case. `npm pack ./packages/genesys` included the CLI, the bridge, and both helpers
with the expected x64 and arm64 PE headers.

Windows was unavailable. `pnpm test:e2e 23-windows-boundaries` discovered three
cases and skipped all three on macOS. Windows runtime acceptance remains open.
