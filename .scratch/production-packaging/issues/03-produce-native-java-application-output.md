# 03: Produce native Java application output

**What to build:** Produce Java application output through the supported native Maven and Gradle build and packaging operations. Use native project settings for targets and dependency layout.

**Blocked by:** 01

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Record the native startup form and available packaging information. Document an example and the required JVM and runtime classpath or package layout.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built native Maven and Gradle classpath layouts with Temurin 21. Inspected compiled registration, application resources, runtime JARs, and the recorded invocation of the native main class.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
