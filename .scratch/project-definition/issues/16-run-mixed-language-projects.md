# 16: Run mixed-language projects

**What to build:** A project discovers, builds, and supervises native Workers across language and package boundaries.

**Blocked by:** 03: Build native Java Workers, 04: Build native .NET Workers, 05: Build native PHP Workers, 06: Build native Python Workers, 07: Build native Ruby Workers, 08: Build native Rust Workers, 09: Build native TypeScript Workers, 11: Run a managed development session.

**Status:** ready-for-agent

**State:** open

- [ ] Integrate all eight SDK implementations without language-based queues or deployment grouping.
- [ ] Respect native import visibility, package boundaries, and independent registration scopes.
- [ ] Cross-language calls retain native Temporal mechanisms and compatible payloads without a required schema system.
- [ ] Diagnostics and inspection identify each source language, definition, Worker entrypoint, and generated build.
- [ ] Preserve per-Worker build resolution, native launch commands, and runtime isolation in a mixed project.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
