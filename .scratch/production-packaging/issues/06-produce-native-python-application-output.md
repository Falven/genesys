# 06: Produce native Python application output

**What to build:** Produce native Python application output with generated registration and dependencies through the supported Python tooling. Preserve native package context and installation paths.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Record the runtime files and startup form. Document environment and path requirements without assuming a virtual environment can move.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
