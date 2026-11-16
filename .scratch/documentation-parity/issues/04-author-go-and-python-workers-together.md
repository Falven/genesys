# 04: Author Go and Python Workers together

**What to build:** Give authors a mixed-language path and accurate references for authoring Go and Python Workers with native package boundaries.

**Blocked by:** 01 Start a Genesys project through the skill

**Status:** ready-for-agent

**State:** resolved

- [x] The Go and Python references describe supported source forms, native tooling, generated registration, build output, and limitations with scoped evidence.
- [x] The mixed-language guide explains package context, native assembly, and independent Worker applications. Bundled readers can understand the example without following a repository-only link.
- [x] Maintained links and the SDK matrix point to the migrated references. Source review, package inspection, and formatting establish the documented path.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `5368a74`.

Recreated the Go and Python example from packed Markdown on macOS arm64. CLI inspection and build succeeded, both native output and startup records were present, and the Python bound Activity registrations could be imported with the recorded `PYTHONPATH`. No Worker launch was needed for this check.
