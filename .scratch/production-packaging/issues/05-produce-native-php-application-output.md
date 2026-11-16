# 05: Produce native PHP application output

**What to build:** Produce a native PHP application tree with consumed registration and required Composer dependencies. Preserve native package and Worker host settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Record the output and startup form. Document required PHP, extensions, native Worker host, working directory, and installation constraints where applicable.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
