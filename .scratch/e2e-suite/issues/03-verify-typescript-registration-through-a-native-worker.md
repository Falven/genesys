# 03: Verify TypeScript registration through a native Worker

**What to build:** A real TypeScript application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small TypeScript native application to exercise ESM/CJS exports and aliases, Activity maps/bound functions, default Workflow identity limits, native bundling imports, Nexus objects and authored Worker options; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.

## Comments

- 2026-11-16. Run `pnpm test:e2e 03-native-typescript` with Node and the
  Temporal CLI on `PATH`. The run used macOS 27.2.1 arm64, Node 26.13.1,
  npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, packed `gsys` 0.0.0,
  TypeScript compiler 6.0.3, Temporal TypeScript Client, Worker and Workflow
  SDKs 1.25.0, Nexus RPC 0.0.3, and Temporal CLI 1.10.0 (Server 1.32.2).
  The test installs dependencies with `npm ci` from the fixture lockfile.
- Wrong package context, lost ESM/CJS identities, or executable analysis
  would change the inspected definitions or write the application marker.
  Inspection checks named re-exports, a file move, the dynamic default
  fallback, helper exclusion, and absent import, constructor, and build
  markers. A second case checks safe reuse of Activity and Nexus names in
  separate Worker scopes, a warning for a dynamic Activity map key, an
  ambiguous entrypoint with both candidates, and errors for a repeated Nexus
  identity within one scope and a runtime import of an Activity by a Workflow.
- Lost generated definitions, native construction, or authored Worker
  settings would change live results. The first build's manifest launches
  its native Worker in the snapshot after a mutation of the authored queue
  file. The SDK Client observes Update validator rejection, then approval
  and Workflow output from the bound ESM Activity, the CJS Activity, and the
  explicit override, each with the authored interceptor prefix. The real
  Nexus call uses the renamed `LookupOrder` operation to return
  `east:beans`. The second operation returns the authored failure
  `east is out of beans`. These calls cover the supported SDK API.
- Stale registration would return the first generation's result after a
  replacement build. The first Worker returns `previous` for
  `PreviousOrder`. The second Worker returns `current` for `CurrentOrder`
  and `fallback:PreviousOrder` for the removed type. The first generated
  module retains its original content.
- The uncorrected product passed the scope and runtime cases. It failed the
  export inspection case by reporting the authored `validateOrder` Update
  validator as a resolved Workflow. All three cases passed in a disposable
  worktree with reviewed product correction `7e2a445`. The ticket remains
  claimed until that correction lands through `main` and the integration
  run confirms the result.
- The [reusable application](../../../e2e/fixtures/typescript-native/app)
  has Worker `orders`, queue `ts-native`, and a no-argument
  `PreviousOrder` Workflow. It takes `TEMPORAL_ADDRESS` and
  `TEMPORAL_NAMESPACE` from the launch environment. Runtime validation
  covers direct startup on macOS arm64 against the pinned SDK release.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 03-native-typescript`. All three cases passed in the selected run on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2). The exported Update validator was excluded from Workflow definitions and retained as a native handler.
