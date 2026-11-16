# 01: Execute a Go Workflow through the installed CLI

**What to build:** A locally runnable packed-CLI test inspects, builds, starts, and completes one native Go Workflow/Activity, then cleans up owned resources.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, R01, C01, K01. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Install the packed CLI into an isolated consumer without monorepo runtime imports; use its executable for inspect, build, and managed startup.
- [x] Use the existing native Go example as prior art; prove the generated registration reaches the expected native Workflow and Activity implementation.
- [x] Provide only the local process/fixture support needed by this complete case: isolated ports and workspace, real Temporal startup, native result observation, output capture, and owned cleanup.
- [x] Expose a documented local filtered run and report missing tool prerequisites clearly; native result success does not itself claim whole-program readiness.
- [x] Make the concrete fixture, installed-CLI launcher, real service lifecycle, and cleanup reusable by later tickets without a general plugin or simulation interface.

## Comments

- 2026-11-16: `pnpm test:e2e 01-installed-go` passed on macOS 27.2.1 arm64
  with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, packed
  `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0, Temporal
  TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
- The npm-installed executable resolved `Greeting` and `Greet`, published
  registration and native output, and managed a noninteractive session on
  a separate loopback port and namespace. The native Client received
  `Hello, Genesys!`. After SIGINT, `gsys` exited with code 0, both started
  child PIDs were gone, and the port refused connections.
- With Go absent from `PATH`, the same command exited 1 and reported
  `Required local tool failed: go version`. TypeScript compilation, scoped
  lint and formatting checks, and `git diff --check` passed.
- This run covers one Go package and a noninteractive POSIX launch on macOS.
  Other OSes, SDKs, and interactive startup remain unrun. The Workflow result
  establishes that generated registration served that call.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 01-installed-go`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) at the final runner fixture exclusion. The equivalent case with review safety fixes also passed on Debian Linux arm64 in local Docker with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2).
