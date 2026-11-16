# 01: Produce native TypeScript application output

**What to build:** Use the application's native compiler and package settings to produce JavaScript or supported native module output. Keep the enclosing package task in control of additional steps. Prevent automatic execution of an enclosing script that invokes `gsys build`, including indirect composition through package tasks.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Establish the shared build record for available target, included dependencies, runtime requirements, and native output paths. Reuse build identity and startup records. Keep build host and artifact target distinct. Preserve publication and include a direct startup example.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Verified a public build invoked by an enclosing npm task. The installed compiler ran directly. Inspected native startup, generated registration, application assets, and copied dependencies. A direct public build no longer invokes package lifecycle hooks. An existing end-to-end expectation for the prebuild hook remains outside this work. Review builds verified registration consumed by JavaScript and TypeScript entries, internal project references, rejected escaping output, and retention of the prior manifest on failure.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
