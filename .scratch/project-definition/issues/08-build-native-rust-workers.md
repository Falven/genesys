# 08: Build native Rust Workers

**What to build:** Rust source definitions produce generated native registration consumed by authored Worker programs and native build tooling.

**Blocked by:** 01: Inspect project sources through gsys.

**Status:** ready-for-agent

**State:** open

- [ ] Discover native Workflows, Activities, and supported Nexus services without executing application code. Recognize multiple definitions per source file.
- [ ] Preserve native names, overrides, visibility, handlers, state ownership, and registration scopes. Report unresolved values and collisions accurately.
- [ ] Generate native imports and registration using application-owned instances, factories, or dependency injection when needed. Never invent constructor arguments.
- [ ] Preserve explicit native assembly for valid patterns beyond static analysis. Distinguish SDK feature limits from tooling limits.
- [ ] Discover native Worker entrypoints from package context. Supply native build and startup commands, working directories, and SDK-specific readiness evidence.
- [ ] Generate inspectable, reproducible artifacts in the agreed generated root or record required native output locations.
- [ ] Use released native SDK APIs. Record exact versions inspected and any build verification limits.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
