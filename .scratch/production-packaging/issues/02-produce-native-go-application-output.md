# 02: Produce native Go application output

**What to build:** Produce the native Go Worker executable with its compiled registration through the supported Go build. Respect target and native linking settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Record available Go target information. Explain runtime dependencies and start the executable directly in the example. Preserve the exact build and launch binding for development retirement.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
