# 02: Verify Go registration through a native Worker

**What to build:** A real Go application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D02, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small Go native application to exercise receiver methods, aliases, native names, package-local visibility, existing instances and Nexus services/factories; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Extend the Go fixture from ticket 01 with multi-definition sources, native names/scopes, aliases, entrypoint ambiguity, static nonexecution and accurate unresolved diagnostics; no duplicate baseline smoke.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.

## Comments

- 2026-11-16: `pnpm test:e2e 02-go-registration` passed on macOS 27.2.1 arm64
  with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, packed
  `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0, Go Nexus SDK 0.7.0,
  and Temporal CLI 1.10.0 (Server 1.32.2). This run is provisional pending
  integration with the product review fixes.
- Inspection preserved aliases, package-local visibility, receiver scopes, and
  native name and prefix overrides. It left the init marker absent, identified
  the closure as requiring explicit assembly, and reported both ambiguous and
  missing Worker entrypoints. The entrypoint errors also stopped the build.
- The Go probe used live Temporal and the exact published Worker command. The
  receiver and interceptor shaped the Workflow result, the query returned
  that result, and the supplied Nexus factory served two operations and the
  authored rejection. The same Workflow name served different implementations
  on separate queues. Explicit closure registration worked alongside the
  generated aggregate.
- The next build served the moved alias and the added Workflow. Temporal
  history showed the Worker reject the removed Workflow. A generated and
  explicit name collision in one registry produced a Genesys warning with
  source references, then the native Worker refused startup.
- Scoped TypeScript type checking, lint, Go formatting, and `git diff --check`
  passed. The reusable application is in
  [`e2e/fixtures/go-registration`](../../../e2e/fixtures/go-registration/).
  Runtime evidence covers direct startup on the stated platform and SDK
  versions.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 02-go-registration`. Passed in the selected macOS run on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) and Go 1.27.4. The case now checks that several mains in one Worker directory retain one unresolved launch plan, while two distinct directories sharing a selector produce an error.
