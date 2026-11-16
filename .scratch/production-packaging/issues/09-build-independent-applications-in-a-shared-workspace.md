# 09: Build independent applications in a shared workspace

**What to build:** Demonstrate independently deployable Go and Python application output in one native workspace. Keep shared dependencies under native tooling and keep application grouping under author control.

**Blocked by:** 02 and 06

**Status:** ready-for-agent

**State:** resolved

See the [production packaging specification](../spec.md).

- [x] Use the existing mixed-language example if suitable. Document selection of the versioned output, native startup, and retention. Demonstrate the author can compose additional steps without infrastructure tools.
- [x] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [x] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [x] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [x] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.

## Comments

2026-11-16: Built the mixed Go and Python workspace with the public build command. Inspected its immutable build record, independent startup commands, compiled Go registration, and the installed Python application and registration. Review also confirmed two independent packages with the same Worker name publish under distinct IDs.

No tests or Worker startup ran. Build and artifact checks do not establish runtime readiness.
