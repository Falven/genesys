# 22: Verify macOS and Linux package and process boundaries

**What to build:** Locally selected POSIX cases detect platform-specific package, path, executable and shutdown defects without rerunning every SDK suite.

**Blocked by:** [19: Shut down owned processes without affecting others](19-shut-down-owned-processes-without-affecting-others.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: E03, K02. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Reuse installed-CLI packaging and owned-process cases from tickets 01 and 19 on the applicable local OS.
- [x] Add only distinct Genesys risks from executable modes, path spelling/characters, packaged native resources, process groups and native shutdown.
- [x] Check platform artifact selection where Genesys owns it. Do not benchmark or duplicate registration semantics across every SDK/OS.
- [x] Record each actual OS/architecture result separately; unrun hosts remain unverified.

## Comments

2026-11-16 — Extended the installed Go case and selected it with the existing
owned-shutdown case.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 01-installed-go 19-owned-shutdown
```

| Local environment                                                 | Result                  |
| ----------------------------------------------------------------- | ----------------------- |
| macOS 27.2.1 (26B131), arm64, system `ps`                         | 5 passed across 2 files |
| Debian 13, Linux 7.0.14-linuxkit arm64 in Docker, procps-ng 4.0.4 | 5 passed across 2 files |

Both focused runs used Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest
5.1.0, packed `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0,
Temporal TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
The Docker run used `--init --platform linux/arm64` and a temporary tooling
image with Go copied from `golang:1.27.4-bookworm`.

The installed CLI resolved the packaged Go analyzer and accepted the same
mixed-case path with spaces, an apostrophe, and Unicode for inspect, build,
and dev. The published manifest selected an executable inside the build
with the correct mode. The build metadata identified the OS and CPU, and
`go version -m` confirmed the selected executable targeted the native host.
The managed Worker returned `Hello, Genesys!` and shut down on SIGINT. The
owned-shutdown cases verified separate process groups, graceful and forced
shutdown, Worker and server exit failures, and survival of an unrelated
service.

A temporary mode-recording defect on macOS made the manifest report 0644
for a 0755 Worker. The new check failed, then passed after restoring the
source. TypeScript, scoped formatting and lint, and Git whitespace checks
passed. These are focused integration-branch results. Other architectures,
Linux distributions, and SDKs remain unverified by this selection.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 01-installed-go 19-owned-shutdown`. All five cases passed on Debian Linux arm64 in local Docker with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with the main-derived product and reviewed runner. The same selected macOS cases passed after the review fixes.
