# 08: Produce native Rust application output

**What to build:** Produce the selected native Rust artifacts through Cargo with generated registration. Preserve native target and feature settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record the available target and runtime requirements. Document direct startup. Cargo executable targets do not establish deployment groups.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built Rust applications with implicit and explicit Apple arm64 target settings. Inspected Cargo executable records, selected features, generated registration symbols, runtime libraries, and direct startup commands.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
