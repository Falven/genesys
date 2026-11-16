# 12: Select Workers and forward native arguments

**What to build:** Worker selectors, executable overrides, and argument forwarding preserve native program semantics.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** open

- [ ] Support repeated --worker selectors and reject unknown names.
- [ ] Support --worker-exec and repeated --worker-arg with first-colon separation. Reject unknown or unselected targets.
- [ ] An override executable and supplied arguments form the complete startup command. Preserve argument boundaries and order without shell evaluation.
- [ ] Forward arguments after -- unchanged to temporal server start-dev, including --db-filename.
- [ ] Resolve server relative paths from invocation cwd and Worker paths from native package cwd. Do not rewrite connection settings or forwarded paths.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
