# 02: Produce native Go application output

**What to build:** Produce the native Go Worker executable with its compiled registration through the supported Go build. Respect target and native linking settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record available Go target information. Explain runtime dependencies and start the executable directly in the example. Preserve the exact build and launch binding for development retirement.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built macOS arm64, Windows amd64 through GOENV, and a cgo external-linking variant. Verified compiled registration, executable target, a native build-tag example with two main packages, and existing development source-to-executable binding. Windows execution remains unverified. Review builds accepted executable mode and rejected plugin mode without publishing a startup plan.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
