# 08: Build native Rust Workers

**What to build:** Rust source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

**Blocked by:** 01: Inspect project sources through gsys.

**Status:** ready-for-agent

**State:** resolved

- [x] Discover native Workflows, Activities, and supported Nexus services without executing application code. Recognize multiple definitions per source file.
- [x] Preserve native names, overrides, visibility, handlers, state ownership, and registration scopes. Report unresolved values and collisions accurately.
- [x] Generate native imports and registration using application-owned instances, factories, or dependency injection when needed. Never invent constructor arguments.
- [x] Preserve explicit native assembly for valid patterns beyond static analysis. Distinguish SDK feature limits from tooling limits.
- [x] Discover native Worker entrypoints from package context. Supply native build and startup commands, working directories, and SDK-specific readiness evidence.
- [x] Generate inspectable, reproducible artifacts in the agreed generated root or record required native output locations.
- [x] Use released native SDK APIs. Record exact versions inspected and any build verification limits.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

Implemented the Rust adapter with the bundled `syn`/`toml` analyzer in `packages/genesys/sdk/rust/analyzer`. Analysis and emission read source text and execute only the isolated bundled parser; authored code, procedural macros, and build.rs are not executed. Native macro imports, aliases, multiple definitions per file, literal names, the `Implementer::method` Activity default, Cargo targets, module paths, and module-local visibility are preserved. Unknown compile-time conditions and expressions remain explicit.

Generated native registration and its scope metadata live under `.gsys/compile/rust/<package-key>/`. Each Activity implementer is registered once with an application-owned instance. Workflow registration retains native handlers and initialization; factory-only Workflows receive an application factory. Authored assembly remains available for unsupported static patterns and collisions. Native `cargo build` and `cargo run` plans retain package configuration and must be rebased by the versioned build publisher.

Inspected released temporalio-sdk/macros 1.2.0. Rust Nexus operation callers are supported by that SDK; public Nexus service handler registration is not. The adapter reports this SDK limit without inventing APIs. Readiness and retirement require separately attributed native evidence; startup never establishes them.

Validation: bundled analyzer `cargo check --locked` and formatting; CLI TypeScript compilation/typecheck and formatting; generated registration compiled with native `cargo check` against SDK 1.2.0 in an external compile-only consumer. The consumer contained multiple Workflows, native name overrides, a factory-only Workflow, private types, a direct macro alias, and two methods sharing one stateful Activity implementer. The first native compile required missing protoc; an isolated protoc from protoc-bin-vendored-macos-aarch_64 3.2.0 enabled successful compilation. No tests, assertion checks, or runtime service calls were added or run. Runtime polling, retirement, other platforms, and other SDK versions were not exercised. See `docs/sdk/rust.md` for boundaries and primary sources.

Final review correction: analyzer temporary Cargo directories are removed in finally after analysis, and emission reuses the parsed result. Installed-package static inspection compiled the helper and left its dedicated TMPDIR empty. Abrupt termination cannot run finally; no process session was run. See [final review evidence](../review.md).
