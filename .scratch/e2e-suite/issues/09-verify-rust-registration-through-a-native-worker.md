# 09: Verify Rust registration through a native Worker

**What to build:** A real Rust application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small Rust native application to exercise native macro definitions, module-local private registration, factory-only Workflows, shared Activity implementers and Cargo targets/features; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.
- [x] The reviewed SDK evidence does not establish Nexus service-handler registration; verify the supported capability for the fixture version and cover the Genesys diagnostic when absent, without a simulated Nexus service.

## Comments

Implemented [the Rust cases](../../../e2e/09-native-rust.test.ts) with a reusable [Cargo package](../../../e2e/fixtures/rust/).

- D01–D07. Installed `gsys inspect` preserves the Rust package context, private module locations, aliased macros, and every native definition in each entry. It excludes helper and test files and leaves the `build.rs` marker absent. Two modules can share a Workflow identity. A duplicate within one module cites both definitions. Unresolved names and invalid Workflows get distinct diagnostics. Duplicate Cargo binary names across packages report both candidates and make inspection fail.
- R01–R05 and R08. Installed `gsys build` generated both registration fragments and published the native binaries. The manifest commands used the matching snapshot paths and forwarded required Cargo features. Real Temporal calls returned `instance:factory-intercepted:42:signaled` from the Workflow factory, the authored Activity interceptor, both methods of one shared Activity instance, and the native Signal. The explicit Workflow served calls alongside generated registration and kept its identity after a file move. Both snapshots served their expected Workflow after replacement. Temporal history recorded that the replacement Worker rejected the removed Workflow.
- R07. Released `temporalio-sdk` 1.2.0 exposes Nexus operation callers and has no public Nexus service-handler registration. The Nexus entry produced `rust.nexus-handler-unsupported` without a generated service.

Both cases passed on macOS 27.2.1 arm64 with Rust and Cargo 1.99.1, Temporal Rust SDK/macros 1.2.0, protoc 31.1, Temporal CLI 1.10.0 with Server 1.32.2, Temporal TypeScript Client 1.25.0, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, and packed gsys 0.0.0. The test uses `protoc` from `PATH` or an executable path supplied in `PROTOC`.

```sh
pnpm install --frozen-lockfile
PROTOC=/tmp/genesys-notes/protoc/protoc-bin-vendored-macos-aarch_64-3.2.0/bin/protoc pnpm test:e2e 09-native-rust
pnpm exec tsc --noEmit
pnpm exec oxlint e2e/09-native-rust.test.ts
rustfmt --check --edition 2024 e2e/fixtures/rust/build.rs e2e/fixtures/rust/src/main.rs e2e/fixtures/rust/src/bin/feature_probe.rs e2e/fixtures/rust/src/temporal/nexus/caller.rs
```

Runtime evidence covers direct launch using each published Cargo command on the stated platform and SDK version.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 09-native-rust`. Both cases passed after the runner review fixes on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with Rust/Cargo 1.99.1 and SDK 1.2.0.
