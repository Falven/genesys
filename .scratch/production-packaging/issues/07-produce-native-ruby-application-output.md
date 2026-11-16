# 07: Produce native Ruby application output

**What to build:** Produce native Ruby application output with generated registration and dependencies through supported native Ruby tooling.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record the startup form and available dependency information. Document the Ruby runtime, native library and installation constraints for the supported layout.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built Ruby applications with Bundler using locked, unlocked, and custom install layouts. Inspected installed gems, generated registration, and Bundler startup settings. Review rejected an absolute Gemfile override before installation, preserving the authored application.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
