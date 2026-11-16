# 07: Build native Ruby Workers

**What to build:** Ruby source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

2026-11-16: Added the internal Ruby adapter and packaged Ripper helper. Static analysis accepts multiple native subclasses, literal name/dynamic options, package-local inheritance and direct aliases, existing Activity instance constants, and native Activity Info constants. Required construction, conditional/private declarations, computed names and registration scopes, metaprogramming, and ambiguous instances remain explicit diagnostics and native assembly. Generated per-source and package arrays use released Worker inputs and relative imports inside the versioned build. Source roles do not assign queues or Workers. Narrow discovery additions recognize Ruby shebang executables in native bin/exe and recognized Worker locations under Ruby package context.

Inspected temporalio 1.11.0 release source for Workflow::Definition, Activity::Definition, Worker, and gem metadata. This release requires Ruby >=3.3 and disables Nexus registration (`enable_nexus: false`); that is reported as an SDK feature limit. Worker launch uses native Ruby/Bundler commands. Native heartbeat attribution and successful polls are required for readiness; process creation and native run methods grant no readiness or retirement claim. Details and primary-source links are in docs/sdk/ruby.md.

Validation: TypeScript `tsc -p packages/genesys/tsconfig.json --noEmit`, oxfmt checks, `git diff --check`, and parser syntax checks on host Ruby 2.6.10 and isolated Docker Ruby 3.4.12 passed. The released Worker, Activity, and Workflow Ruby sources passed Ruby 3.4.12 syntax checks. An isolated Ruby 3.4 container installed temporalio 1.11.0-aarch64-linux and its dependencies successfully. Image digest: sha256:3acb7705baee45c4815270dbedf953e95c34e25d5440babadf5ae451a706d012. Installation used the released native binary gem; it was not a bridge source build. No tests, assertion-based checks, application Worker execution, Temporal connection, or end-to-end runtime compatibility checks were performed.
