# 15: Retire eligible Worker versions

**What to build:** Native retirement evidence permits graceful removal of previous Workers and unused builds while required versions remain available.

**Blocked by:** 14: Replace Workers after source changes.

**Status:** ready-for-agent

**State:** open

- [ ] Keep readiness separate from retirement eligibility.
- [ ] Retain versions needed by pinned Workflows. Account for supported native versioning APIs, evidence freshness, and unresolved native identity.
- [ ] Do not change Current or Ramping versions, move pinned executions, or bypass native drainage.
- [ ] Retire only with sufficient native evidence and preserve builds until the corresponding processes exit.
- [ ] Explicit session shutdown remains separate from automatic retirement.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
