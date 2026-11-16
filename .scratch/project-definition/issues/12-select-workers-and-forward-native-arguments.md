# 12: Select Workers and forward native arguments

**What to build:** Worker selectors, executable overrides, and argument forwarding preserve native program semantics.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** resolved

- [x] Support repeated --worker selectors and reject unknown names.
- [x] Support --worker-exec and repeated --worker-arg with first-colon separation. Reject unknown or unselected targets.
- [x] An override executable and supplied arguments form the complete startup command. Preserve argument boundaries and order without shell evaluation.
- [x] Forward arguments after -- unchanged to temporal server start-dev, including --db-filename.
- [x] Resolve server relative paths from invocation cwd and Worker paths from native package cwd. Do not rewrite connection settings or forwarded paths.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

- Added the standard Node argument parser boundary in `dev-options.ts`. Worker selection defaults to every published native program. Unknown names and override targets outside the selected set fail before Worker launch.
- Each Worker value splits only at its first colon. Argument values remain array elements, including empty strings. Executable overrides discard every inferred startup argument; argument-only options append to the inferred native command. The existing owned-process launcher uses `shell: false`.
- The parser separates server argv before parsing Genesys options. Existing Temporal startup keeps the invocation cwd; selected Worker commands retain the immutable build's native cwd, environment, and connection settings. CLI usage and package documentation describe these semantics.
- Exported `selectWorkers` for each build and `hasStartupOptions` for the supervisor-reuse guard. No selector or separator-only invocation requests startup reconfiguration.
- Verification: Node 26.13.1; package typecheck and build, formatting of changed files, scoped oxlint, and `git diff --check` passed. No tests, test harnesses, assertion self-checks, or runtime process launches ran. Native argument parsing and live Worker behavior were not exercised.
- Review correction: an executable override now works when native analysis cannot infer a startup command. Analysis retains `WorkerProgram.workingDirectory` from the inferred command or known package root; publication resolves and checks it within the isolated build. An override uses this directory and only supplied arguments. Unknown directories fail clearly; arguments without an executable still require an inferred startup command. No package IDs or invocation directories are used to infer Worker cwd.
- Correction verification: package compilation, formatting, scoped oxlint, and `git diff --check` passed under Node 26.13.1. No tests or runtime checks ran.

Final review correction: unresolved named Go/Java entrypoints retain native build plans and package cwd, so explicit executable overrides reach selection. Shared SDK normalization preserves an adapter-supplied cwd. Server argv remains unchanged; only explicit database paths are resolved separately for watch/snapshot exclusion. See [final review evidence](../review.md).
