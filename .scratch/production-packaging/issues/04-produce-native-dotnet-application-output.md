# 04: Produce native .NET application output

**What to build:** Produce .NET application output through supported native project build and packaging operations. Respect native project runtime and deployment settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record available target and dependency information and the native startup command. Document the output and requirements for the supported native deployment modes.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built framework-dependent .NET output with default and explicit osx-arm64 settings. Inspected compiled registration, native dependencies, runtime configuration, and startup. An unsupported single-file layout preserved the prior selected manifest.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
