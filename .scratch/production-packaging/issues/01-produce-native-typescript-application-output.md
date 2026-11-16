# 01: Produce native TypeScript application output

**What to build:** Use the application's native compiler and package settings to produce JavaScript or supported native module output. Keep the enclosing package task in control of additional steps. Prevent automatic execution of an enclosing script that invokes `gsys build`, including indirect composition through package tasks.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Establish the shared build record for available target, included dependencies, runtime requirements, and native output paths. Reuse build identity and startup records. Keep build host and artifact target distinct. Preserve publication and include a direct startup example.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
