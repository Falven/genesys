# 06: Produce native Python application output

**What to build:** Produce native Python application output with generated registration and dependencies through the supported Python tooling. Preserve native package context and installation paths.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record the runtime files and startup form. Document environment and path requirements without assuming a virtual environment can move.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built Python applications through pip, uv, and Poetry. Inspected installed application dependencies, generated registration, and environment paths. A Poetry project with two console scripts produced native output without an inferred startup command.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
