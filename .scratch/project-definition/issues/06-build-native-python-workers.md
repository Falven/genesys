# 06: Build native Python Workers

**What to build:** Python source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

Implemented the Python native adapter with a packaged Python 3.11+ standard-library AST helper. Analysis and emission read supplied source text without importing authored modules. Multiple decorated Workflow classes, Activity functions/bound methods, Nexus handler classes, explicit import aliases/re-exports, literal names, native dynamic definitions, and local Nexus service contracts are represented. Generated tuples preserve native class/callable/handler objects and accept application-owned instances without constructor calls or a per-definition authored list.

Generated modules and registration metadata live under `.gsys/compile/python/`. Package context supplies flat/src/setuptools/Poetry import roots and native console or module entrypoints. Build commands use a build-local environment, lock-aware uv/Poetry where present, or venv/pip, then native syntax compilation. Commands and PYTHONPATH resolve from the analyzed build workspace. Python virtual environments are not relocatable: publication must retain the built workspace's absolute path or rebuild its environment at the final path.

Explicit native assembly remains available for runtime-generated, conditional, custom-decorated, wildcard-imported, and otherwise unresolved forms. Native literal Worker scopes receive collision checks; aggregate collection collisions are warnings because independent native scopes remain valid. Unsupported Pipenv resolution and unusual source mappings are tooling limits, not SDK feature limits. Readiness stays unavailable until supervision obtains attributed native heartbeat/poll evidence and complete instance coverage.

API evidence: released temporalio 1.36.1 and its nexus-rpc 1.5.0 dependency. Details and primary-source links are in `docs/sdk/python.md`. Validation run: TypeScript no-emit typecheck and compilation, Python `py_compile`, Ruff lint/format, oxfmt, and Git whitespace check. No tests, harnesses, assertion checks, SDK runtime application execution, or service startup were added or run. Native dependency installation and cross-platform launch remain unverified.
