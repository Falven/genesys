# 06: Verify .NET registration through a native Worker

**What to build:** A real .NET application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small .NET native application to exercise attributes, partial/nested types, inherited/nonpublic Activities, supplied instances, native Hosting construction and unresolved project forms; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.

## Comments

Three installed CLI cases passed in [06-installed-dotnet.test.ts](../../../e2e/06-installed-dotnet.test.ts). Copy the [native .NET fixture](../../../e2e/fixtures/dotnet) into the application tree. It uses the `dotnet-raw` Task Queue by default. Set `GENESYS_DOTNET_MODE=hosted` for native Hosting on `dotnet-hosted`. Both modes use `TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE`.

- D01–D04, D06, D07. Wrong package assignment or registration of helper/test code changes the inspection inventory. The inventory also checks aliases, multiple Workflows in one file, inherited and private partial Activity identities, and a Workflow file move. Marker files detect execution of the application or an MSBuild hook during inspection. A conditional project withholds publication, a nameless Activity lambda reports a native validation error, and two named Worker directories withhold launch and expose both candidates.
- D05. Distinct instances expose the same Activity name from separate native Worker options. Moving the Activity methods into a single generated static aggregate produces a collision with both symbols and preserves the prior publication.
- R01–R05, R07, R08. The installed CLI publishes a framework-dependent .NET assembly and its dependencies. The manifest command starts raw and Hosting Workers against local Temporal. The C# Client sends the Signal and reads the result of the generated inherited and private Activities, the Worker interceptor, and the two Nexus operations. The Nexus success value distinguishes supplied and Hosting dependencies, and the failure preserves the authored error. The custom native Workflow factory remains callable under its override. A second publication removes the retired Workflow from registration and serves its replacement without a registration list edit.

Verified on macOS 27.2.1 arm64 with .NET SDK 10.0.404, Temporalio and Temporalio.Extensions.Hosting 1.22.0, NexusRpc 0.5.0, Microsoft.Extensions.Hosting 10.0.0, Temporal CLI 1.10.0 (Server 1.32.2), Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, and gsys 0.0.0. Run with .NET SDK 10 and the Temporal CLI on `PATH`.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 06-installed-dotnet
pnpm exec tsc --noEmit
pnpm exec oxlint e2e/06-installed-dotnet.test.ts
```

The runtime cases use the published native command and an independently started Temporal server. Linux, Windows and managed `gsys dev` startup were unrun for this fixture.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 06-installed-dotnet`. All three cases passed in the selected run on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) and .NET SDK 10.0.404.
