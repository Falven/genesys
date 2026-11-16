# 03: Build native Java Workers

**What to build:** Java source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

Implemented the internal Java adapter and shipped JDK syntax reader. Static discovery resolves source contracts, inheritance, native names and overrides, grouped Activity implementation instances, Workflow classes and dynamic handlers, and annotated Nexus service implementations. Generated aggregates accept application-owned typed instances and provide no-argument construction overloads where native constructors permit it. Signals, Queries, Updates, validators, and Nexus operations remain owned by the native implementation. Explicit native assembly remains available with diagnostics for unresolved metadata, visibility, constructor, source-layout, and launcher forms. No application code or annotation processor runs during analysis/emission.

Maven and Gradle plans discover native main classes in named Worker directories. Both run in the package context of the isolated build; generated source paths and the Gradle init-script path are recorded as artifacts. Native readiness is explicitly unknown until process-attributed polling evidence exists.

Verified released Temporal Java SDK 1.40.0 registration/metadata APIs and its Nexus SDK 0.6.0-alpha dependency. TypeScript typecheck/format passed. The JDK reader compiled with isolated Temurin 21.0.13+9. An external temporary native application with inherited multi-method Activities, a dependency-bearing Activity, Workflow/Signal, and Nexus service consumed the emitted aggregate and compiled successfully with Maven 3.9.11 and Gradle 9.2.1. Both builds included generated source and copied runtime dependencies. Java `--dry-run` accepted both generated classpaths and the discovered Worker main class; the main method was not run.

Limits: no tests or self-check harnesses, Worker polling, Linux build, or Windows build. No full compiler attribution or execution of Maven/Gradle models during inspection; external/generic contracts, Kotlin, custom launch models, and inaccessible definitions retain explicit native assembly. SDK factory APIs marked for testing are not used for production Workflow construction. See `docs/sdk/java.md` for exact native source references and build limits.

Final review correction: optional aggregate collisions now warn and omit the ambiguous aggregate. Activity/Nexus instances must all be supplied by authored code; the constructor overload was removed. Named Workers without main remain available for executable overrides. The existing native Java sample compiled through the installed CLI after its authored call supplied every instance. See [final review evidence](../review.md).
