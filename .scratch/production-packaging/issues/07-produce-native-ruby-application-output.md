# 07: Produce native Ruby application output

**What to build:** Produce native Ruby application output with generated registration and dependencies through supported native Ruby tooling.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Record the startup form and available dependency information. Document the Ruby runtime, native library and installation constraints for the supported layout.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
