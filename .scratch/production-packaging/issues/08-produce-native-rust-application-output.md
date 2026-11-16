# 08: Produce native Rust application output

**What to build:** Produce the selected native Rust artifacts through Cargo with generated registration. Preserve native target and feature settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Record the available target and runtime requirements. Document direct startup. Cargo executable targets do not establish deployment groups.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
