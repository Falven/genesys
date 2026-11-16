# 02: Build native Go Workers

**What to build:** Go source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

2026-11-16: Implemented `goAdapter`, pinned native Go package/type analyzer, native same-package registration and discovery-root aggregate imports, generated receiver/factory groups, explicit native override and grouped Activity scope inspection, native Worker build/start plans, and source-linked unresolved-pattern diagnostics. Added shared SDK loading/emission/build orchestration and `gsys inspect`/`gsys build`; packaged helper assets and required PHP/TypeScript analyzer dependencies for the other SDK tickets. Generated ownership markers prevent overwriting authored files and generated outputs do not become new discovery entries.

Validation: CLI TypeScript build/typecheck, Go analyzer `go build`, gofmt/oxfmt, and native compilation of a temporary authored Worker with generated registration for two Workflows, Activity functions/receiver methods, and a Nexus service. SDK latest lookup and released source review resolved Go SDK v1.51.0; bundled analyzer uses x/tools v0.52.0. No application startup, tests, harnesses, or assertions ran.

Limits: dynamic names/closures, indirect assembly, arbitrary factory behavior and full Worker-instance coverage remain explicit/unresolved with diagnostics. Native dependency construction, lifecycle and readiness retain the application/SDK boundary. Initial shared build writes owned generation then builds; isolated version publication belongs to ticket 10. Cross-platform execution and older SDK compatibility remain unverified. Details and native references: `docs/sdk/go.md`.

Final review correction: Go inventory now uses stdin. Compiler-resolved native message handlers and validators are excluded from automatic registration while explicit native registration is retained. Unresolved named Worker entrypoints remain available for executable overrides. Native helper and installed-package Go example builds passed. See [final review evidence](../review.md).
