# 04: Build native .NET Workers

**What to build:** .NET source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

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

- Implemented `dotnetAdapter` and an isolated Roslyn helper. Analysis parses source and literal project XML and reads pinned SDK metadata; it does not load authored assemblies, run source generators, or evaluate authored MSBuild hooks.
- Discovers concrete C# Workflows, each attributed Activity (including non-public, inherited, local, and lambda forms), and supported Nexus service-handler contracts. Preserves native constants/defaults/dynamic names. Lexical delegates and custom native factories retain explicit assembly with diagnostics. Generated aggregate collisions are distinguished from potential cross-Worker name reuse.
- Emits `GenesysRegistration.g.cs` beside the native project for its default compile glob. Raw options use existing-instance Activity/Nexus registration plus Workflow/static-Activity helpers. Hosting extensions are emitted only when that native dependency is present; native DI lifetimes remain authored. No constructor arguments or per-definition authored lists are invented.
- Resolves native Main/top-level executable entrypoints and supplies isolated `dotnet publish`/DLL launch commands. Readiness is explicitly unavailable without attributable native heartbeat and polling evidence; process creation does not authorize retirement.
- Tooling limits are explicit: F#/VB remain inventory and native assembly; conditional/imported/custom MSBuild inclusion, multiple targets/projects, unresolved dependencies, custom launch outputs, and unknown factories do not produce guessed registration or launch plans. These are not claims that the native SDK lacks those features.
- Reviewed Temporalio 1.22.0 at `cbc534dae82474cfdab6a9245efbc79deb6dfbf4` and NexusRpc 0.5.0. Built the Roslyn helper with isolated .NET SDK 10.0.404 (zero warnings/errors), ran package TypeScript type checking, formatted C#/TypeScript/Markdown, and checked the diff. No tests, test harnesses, assertions, application builds, Worker execution, or live Temporal checks were run. Generated registration compatibility remains subject to the authored native application build.

Final review correction: emission reuses the paired Roslyn analysis instead of compiling and executing the helper a second time. CLI compilation and static review passed; the unchanged native helper was not rebuilt for this correction. See [final review evidence](../review.md).
