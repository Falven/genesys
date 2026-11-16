# 09: Build independent applications in a shared workspace

**What to build:** Demonstrate independently deployable Go and Python application output in one native workspace. Keep shared dependencies under native tooling and keep application grouping under author control.

**Blocked by:** 02 and 06

**Status:** ready-for-agent

**State:** open

See the [production packaging specification](../spec.md).

- [ ] Use the existing mixed-language example if suitable. Document selection of the versioned output, native startup, and retention. Demonstrate the author can compose additional steps without infrastructure tools.
- [ ] Produce output through the existing `gsys build` command with native tooling. Include the consumed registration and required application files.
- [ ] Preserve native startup and user control of distribution. Do not infer application grouping from discovery or package context.
- [ ] Record available build information and document known requirements. A successful build does not establish runtime readiness.
- [ ] Verify through ordinary builds, artifact inspection, and review as applicable. Record verification limits. Do not add or run tests.
