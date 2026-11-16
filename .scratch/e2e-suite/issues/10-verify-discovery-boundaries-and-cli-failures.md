# 10: Verify discovery boundaries and CLI failures

**What to build:** Installed CLI checks detect wrong source/package ownership, authored-code execution during inspection, and misleading or truncated output.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D03, D06, D07, C06. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Check several discovery roots, nested native package boundaries, excluded helper/test/generated files, and package-context ambiguity through inspect.
- [x] Use observable application side-effect sentinels to prove inspection does not execute authored source or native build hooks; reuse SDK fixtures only for the forms needed by the case.
- [x] Check help/version, invalid commands, complete large JSON output, diagnostic stderr and exit codes through real subprocesses.
- [x] Check missing tools/dependencies fail clearly. Report native recognition limits separately from invalid source and do not add a fallback that hides them.

## Comments

Added four cases using the packed CLI in [10-discovery-and-cli.test.ts](../../../e2e/10-discovery-and-cli.test.ts).

- D01, D03, D07. The installed CLI assigns three discovery roots to the correct TypeScript packages, withholds helper, test and generated sources, honors a package-declared Worker entrypoint, lists ambiguous candidates, and leaves unavailable startup unresolved. Inspection leaves four execution markers absent. Direct native execution then produces the import, constructor, factory, and build markers, which verifies the probes.
- D06, D07. With the real .NET SDK available, inspection names the two competing project files, distinguishes the static tooling limit, and withholds a launch command. With only Node visible on `PATH`, inspection reports the missing `dotnet` host and exits 1. TypeScript reports a missing native SDK as an unresolved dependency and exits 1 for invalid syntax. The authored npm build fails with the missing dependency on stderr and leaves no selected manifest. [Ticket 08](08-verify-ruby-registration-through-a-native-worker.md) exercises the unavailable native SDK capability.
- C06. Help and version exit 0 with empty stderr. Unknown commands and options exit 1 with empty stdout. Piped inspection returns over 1 MiB of parseable JSON with all 4,096 Workflow definitions and matches the written manifest. Diagnostics use stderr.
- C06 before the fix. A real npm build succeeds and publishes its manifest, but npm and its authored script print ahead of the JSON on stdout. The regression requires a complete JSON build record for the selected ID on stdout and the authored log on stderr.

Run on macOS arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, the packaged TypeScript 6.0.3 analyzer, gsys 0.0.0, and .NET SDK 10.0.404. The TypeScript fixture declares `@temporalio/worker` 1.25.0 and leaves it uninstalled for the missing dependency case. The .NET helper restores pinned Temporalio 1.22.0 metadata. The test requires .NET SDK 10 on `PATH` and access to its restore cache or NuGet. The missing-tool check uses a Node symlink and a Unix executable path.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 10-discovery-and-cli
pnpm exec tsc --noEmit
pnpm exec oxfmt --check e2e/10-discovery-and-cli.test.ts
```

Three cases, type checking, and formatting passed. The build JSON case failed on stdout contamination. Linux and Windows remain unverified for this ticket.

2026-11-16. Provisional `pnpm test:e2e 10-discovery-and-cli` passed all four cases on ticket branch commit `6e3def1` after the stream fix in `50a8700`. The selected build ID matches the JSON on stdout. The native npm build and the authored log appear on stderr. A process check with the real managed build job and exported `buildProject` verified the native stdout and stderr streams and the managed `build@<id>` labels. The two build-publication cases and the development launch case also passed with the fix.

Verification used macOS 27.2.1 arm64 and the tool versions above. The nearby build and launch cases used Go 1.27.4, Temporal Go SDK 1.51.0, Temporal CLI 1.10.0 (Server 1.32.2), and Temporal TypeScript SDK 1.25.0. `pnpm exec tsc --noEmit`, scoped `pnpm exec oxfmt --check`, and `git diff --check` passed. The ticket remains claimed pending a run on `main` with the merged product changes.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 10-discovery-and-cli`. All four cases passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2). The merged CLI build path emits its build record on stdout and preserves native command logs on stderr.
