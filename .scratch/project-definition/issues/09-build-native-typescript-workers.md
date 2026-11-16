# 09: Build native TypeScript Workers

**What to build:** TypeScript source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

Implemented in `packages/genesys/src/sdk/typescript.ts`; usage and limits are in `docs/sdk/typescript.md`.

- Static compiler analysis resolves package exports, aliases/re-exports, multiple Workflow and Activity exports, existing Activity maps, native Worker registration scopes, bound functions/closures and typed factory results without executing authored code. Native default Workflow exports retain fallback identity. Native assembly remains application-owned when construction or keys are dynamic.
- Generated Workflow exports, Activity maps and Nexus service arrays are separate ordinary modules beside each discovery root. Workflow generation imports no Activity implementation. Static ESM sandbox violations, unresolved modules, ambiguous aggregates and native scope collisions have diagnostics. Identical re-exports are deduplicated; independent native scopes can reuse names.
- Native package main/bin declarations, executable call sites, tsconfig output paths and package build scripts determine Worker plans. Ambiguous or custom output paths retain startup overrides. Readiness metadata requires attributed heartbeat/poll evidence and keeps retirement separate.
- Reviewed released `@temporalio/worker` 1.25.0 and published `nexus-rpc` 0.0.3 source on 2026-11-16. TypeScript 7.0.2 no longer exposes the needed compiler API; the tooling uses runtime alias `typescript-compiler` pinned to TypeScript 6.0.3. Shared package dependency ownership is ticket 02.
- Validation: native TypeScript 7.0.2 CLI type check and package build; oxfmt formatting check; `git diff --check`. No tests, test harnesses, assertion self-checks or authored modules were executed. No Temporal TypeScript application exists here for a native SDK application build; runtime SDK compatibility, custom bundlers, dynamic instance coverage and live polling remain validation limits.

Final review correction: native setHandler handler and validator references are excluded from generated Workflow exports through compiler symbol resolution, including const aliases, shorthand options and re-exports. Dynamic ambiguity stays diagnostic. CLI compilation and static review passed; no authored runtime check was run. See [final review evidence](../review.md).
