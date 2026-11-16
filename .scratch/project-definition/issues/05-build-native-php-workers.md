# 05: Build native PHP Workers

**What to build:** PHP source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

Implemented PHP AST discovery and native registration in `packages/genesys/src/sdk/php.ts`. The parser is `php-parser` 3.7.0, and native RoadRunner YAML uses `yaml` 2.9.1. Shared runtime dependency integration belongs to ticket 02. Added `.rr.yaml`/`.rr.yml` static inventory and `docs/sdk/php.md`.

Concrete classes, namespace imports and grouped imports, attributes, local interfaces/inheritance, Workflow-owned handlers, and grouped Activity methods retain native registration. Generated PHP accepts the existing SDK `registerActivity` factory signature, registers each Activity type once, and leaves native construction and Worker placement to authored code. Literal identities and emitted-scope collisions are reported. Dynamic names and competing inherited Workflow metadata remain unresolved. External ancestors, conditional declarations, trait adaptations, annotations, custom readers, and enums retain explicit native assembly with tooling-limit diagnostics. Composer must autoload concrete types; multi-class files can use native classmaps. No custom queue, lifecycle, or container model was added.

Native launch uses an unambiguous authored RoadRunner YAML config and `rr serve -c`, with Composer package build commands and native PHP syntax compilation. Config ambiguities retain executable overrides. Readiness metadata identifies the RoadRunner host PID and requires attributable native heartbeat and successful poll evidence; PHP startup and pool readiness are insufficient. Polling and retirement remain separate. The SDK v2.19 has no public Nexus service registration API; Nexus entries report that feature limit instead of invented registration.

Release evidence: inspected `temporal/sdk` v2.19 at `a5aa7bcad43576c22357560601fe5eddc4b3ede6`, including WorkerInterface, WorkflowReader, ActivityReader, ClassNode, and WorkerOptions. Reviewed official samples at `temporalio/samples-php` commit `4bb23c60565f2671bd4d1b3c13ca021623e8b0a4`.

Validation: TypeScript compilation and scoped oxfmt passed. The host has no PHP/Composer; Docker was available. An isolated temporary native build used the unmodified official SimpleActivity source files in the discovery layout with Composer classmap autoload. The generated registration retained `SimpleActivity.greet` and `SimpleActivity.ComposeGreeting`. A Docker toolchain based on Composer image digest `sha256:ca11f643d7791ebdd90a34fc20caf11380d434007ae539a9ea75cd9212e13dca`, with the required native sockets extension, ran Composer 2.11.2 on PHP 8.5.12, installed `temporal/sdk` v2.19 and its dependencies, and passed `php -l` for all four authored PHP files and the actual emitted registration. The initial unextended Composer image correctly failed for missing `ext-sockets`; the native extension was installed rather than bypassing platform requirements.

No tests, test harnesses, assertions, or live services were added or run. Native dependency installation and syntax compilation do not establish live polling, replay/payload compatibility, runtime factory behavior, or all platform combinations. The application retains explicit native assembly for documented static limits.

Review correction: computed PHP attribute names and Activity prefixes now use `identity.state: unresolved`, with their source reason preserved. PHP analysis does not classify these expressions as native dynamic catch-all definitions. Updated the corresponding diagnostic and documentation.

Final review correction: duplicate identities in an optional aggregate now warn and omit that aggregate. Valid independent native Worker scopes remain buildable through explicit assembly. CLI compilation and static review passed; no new PHP runtime check was run. See [final review evidence](../review.md).
