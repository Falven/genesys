# 16: Run mixed-language projects

**What to build:** A project discovers, builds, and supervises native Workers across language and package boundaries.

**Blocked by:** 03: Build native Java Workers, 04: Build native .NET Workers, 05: Build native PHP Workers, 06: Build native Python Workers, 07: Build native Ruby Workers, 08: Build native Rust Workers, 09: Build native TypeScript Workers, 11: Run a managed development session.

**Status:** ready-for-agent

**State:** resolved

- [x] Integrate all eight SDK implementations without language-based queues or deployment grouping.
- [x] Respect native import visibility, package boundaries, and independent registration scopes.
- [x] Cross-language calls retain native Temporal mechanisms and compatible payloads without a required schema system.
- [x] Diagnostics and inspection identify each source language, definition, Worker entrypoint, and generated build.
- [x] Preserve per-Worker build resolution, native launch commands, and runtime isolation in a mixed project.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.


## Comments

2026-11-16: Integrated mixed native packages through the existing eight-adapter analysis, generation, isolated build, and supervisor command pipeline. Kept the full source inventory available for real native imports while retaining package-specific registration entries. Fixed nested Composer RoadRunner config ownership, Java module-info source inclusion, Ruby independent-package symbol indexes with literal require_relative traversal, and Python foreign-package Worker registration scopes. Python workers/__init__.py now remains package initialization instead of producing an unnamed-Worker error. Independent native identities remain valid; CLI Worker-name ambiguity is separate from registration conflicts.

Added examples/mixed-workers with a root Go module and nested Python package. Native Greeting Workflow calls ComposeGreeting and UppercaseGreeting by Activity name with JSON string payloads. One application-owned Python Greeter instance supplies both generated bound registrations. Both programs use the authored greetings Task Queue; the Go Worker explicitly disables remote Activity polling with the SDK's LocalActivityWorkerOnly option. No language queue, deployment group, schema system, startup script, or authored definition list was added. The docs explain all eight native package contexts, code resolution, inspection, compatible payload agreement, and readiness/retirement limits.

Closed a related Ruby construction gap: generated activities(...) methods accept required native Activity instances once per implementation class, record class/parameter metadata, and aggregate all discovered eligible classes. Native zero-argument class registration, existing instance constants, and Info constants remain available. No incomplete ACTIVITIES constant is emitted when the collection requires instance arguments. Private, conditional, reopened, load-path-dependent, and other unresolved forms retain explicit native assembly diagnostics.

Validation: CLI TypeScript build and typecheck, Python py_compile of the analyzer and authored example modules, Ruby parser ruby -c, Go formatting, scoped oxfmt, git diff --check, and independent source review passed. The full Go/Python native build passed after merging integration at 095cf75, using Node 26.13.1, Go 1.27.4, and Python 3.15.2 on macOS arm64. Native commands compiled the Go executable, created the isolated Python environment, installed temporalio 1.36.1 and the authored package, and compiled generated Python registration. Published build ccae4bbd-7f6f-49c8-a4fd-bc545fd9d6b3 records both Worker source languages, exact native commands and workingDirectory/start.cwd fields, generated source, and Python source/registration paths inside the matching snapshot. Reviewed those manifest fields and generated Go/Python registration. Python dependency resolution remains unlocked beyond its pinned SDK.

No tests, test harnesses, assertion-based self-checks, Worker startup, Temporal calls, or runtime cross-language exchange were added or run. Ruby generated instance wiring received TypeScript checking and source review; its runtime consumption was not executed. Package-boundary changes received source review and parser/compiler checks, not synthetic fixtures. These checks do not establish runtime compatibility across all eight SDKs or other operating systems. Static whole-program readiness remains unavailable where native evidence is incomplete; no missing evidence permits Worker retirement.
