# 04: Verify Python registration through a native Worker

**What to build:** A real Python application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08, B07. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small Python native application to exercise decorators, aliases, bound methods and supplied instances, native package entrypoints, generated imports and stable final-path environments; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.
- [x] Execute the native entrypoint from its final immutable environment and check that generated imports and environment paths do not resolve back to authored source or an earlier build.

## Comments

- 2026-11-16. `pnpm test:e2e 04-native-python` passed both cases on macOS 27.2.1
  arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  packed `@genesys/cli` 0.0.0, Python 3.15.2, Python SDK `temporalio` 1.36.1,
  `nexus-rpc` 1.5.0, and Temporal CLI 1.10.0 (Server 1.32.2).
- Installed `gsys inspect` resolved multiple definitions under two Python
  discovery roots, preserved independent registration scopes, and left all
  side-effect markers absent. Focused edits produced a native collision, an
  ambiguous entrypoint with no startup command, and a Python syntax error
  distinct from the warning for a computed decorator name.
- Installed `gsys build` published both builds. The native Python Client
  observed the generated private bound Activity, authored interceptor,
  explicitly added Activity, and accepted and rejected Workflow Updates. A
  generated Nexus handler returned its instance's result and its other
  operation returned the expected failure. Each manifest's console script ran
  from its own virtual environment after the source edit and publication of
  the newer build. The old and new builds ran only their respective transform
  Activities and imported their own source and generated modules.
- `pnpm exec tsc --noEmit`, scoped `oxlint` and `oxfmt --check`, and
  `git diff --check` passed. This run covers the setuptools and pip console
  script path on macOS. Other package managers and operating systems remain unrun.
- Reuse the authored package in [e2e/fixtures/python](../../../e2e/fixtures/python).
  The Worker imports the generated namespace for `src/python_probe/temporal`.
  When nesting the fixture under a new project-relative directory, use the
  generated import name for that discovery root.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 04-native-python`. Both cases passed in the selected run on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2).
