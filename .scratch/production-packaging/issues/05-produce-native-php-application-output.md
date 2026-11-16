# 05: Produce native PHP application output

**What to build:** Produce a native PHP application tree with consumed registration and required Composer dependencies. Preserve native package and Worker host settings.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record the output and startup form. Document required PHP, extensions, native Worker host, working directory, and installation constraints where applicable.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built the PHP application with Composer and inspected the installed SDK, autoloader, registration, RoadRunner settings, and native startup command. Checked PHP and extension requirements with Composer in an existing local tool image. Review verified the production Composer command skips package scripts and still installs the autoloader and generated registration. The existing hook-marker expectation remains outside this work.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
