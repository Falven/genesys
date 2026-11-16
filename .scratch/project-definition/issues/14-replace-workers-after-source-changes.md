# 14: Replace Workers after source changes

**What to build:** Source changes build and start replacement Workers while existing Workers and Temporal remain active.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** resolved

- [x] Watch source and relevant package inputs without rebuild loops from generated output.
- [x] Build and start the candidate before retiring its predecessor. Require native readiness evidence.
- [x] Keep the current Worker on build or startup failure. Report errors and keep watching.
- [x] Keep Temporal running and preserve each Worker’s matching build.
- [x] Unknown retirement eligibility retains the previous version. Do not claim replay compatibility or alter native task routing.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

- Added serial, coalesced source watching before the first build. Initial and later build/start failures report errors and preserve the watcher, existing Workers, and Temporal.
- Development builds execute in an owned internal process group that includes native analysis and build descendants. Owner shutdown stops scheduling and signals that group; it waits for all owned groups before stopping Temporal. Completed build results are validated against their own manifest before cleanup authority is adopted.
- Each candidate reapplies ticket 12 selection and argument handling. Source revisions prevent superseded candidates or asynchronous retirement queries from retiring newer state. Readiness observations and the asynchronous native retirement decision are separate; unknown decisions retain prior versions. Ticket 15 supplies native eligibility rules through `DecideRetirement`.
- Live process groups retain their exact PublishedBuild. Only owned unused snapshots can be removed, after group exit; the manifest-selected build is preserved. Generated headers, recorded native outputs, dependencies, caches, and package-specific native output directories do not trigger rebuild loops.
- Verification: `pnpm --filter @genesys/cli typecheck`, package build, scoped `oxlint`, `oxfmt`, and `git diff --check` passed. A native Go example build through compiled `build-job.js` passed under Node 26.13.1 and Go SDK v1.51.0; pre-generation analysis reports the expected missing generated registration package before emission/build succeeds.
- Limits: No tests, test harnesses, assertions, live replacement sessions, or shutdown/readiness runtime checks. Existing managed-process platform restrictions remain. Native eligibility is intentionally delegated to ticket 15; no routing or replay-compatibility claim is added.

- Watcher resource follow-up: replaced recursive `fs.watch` with exact stable Chokidar 6.0.0, verified against its primary release documentation and npm registry metadata. Selected `backend: "native"` so macOS/Windows do not default to recursive OS watching. Dependency/generated/native-output directories are excluded before traversal; recorded outputs are unwatched, and symlink targets are not followed. Initial build waits for the ready scan. Watcher/filter errors now report a failing exit status and stop the owner session instead of silently losing change detection. Async close is awaited during shutdown. Existing build-failure recovery and source-revision guards remain.
- Follow-up validation: TypeScript compilation, package build, scoped lint, formatting, and diff checks; no tests, assertions, runtime watcher sessions, or resource-exhaustion checks.

Final review correction: rejected process completion requests session shutdown without marking the generation ended or releasing its build. Explicit Temporal database files and SQLite sidecars are excluded from watches and snapshots, including canonical symlink paths. Ticket 15 is open: native heartbeat snapshots do not authorize automatic retirement; previous programs remain until explicit shutdown. See [final review evidence](../review.md).
