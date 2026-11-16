# 13: Reuse an existing supervisor

**What to build:** A later development invocation reuses a responding supervisor without generation, builds, watching, or process startup.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** resolved

- [x] Record the last ready endpoint per project root and probe it before any build or startup.
- [x] Allow new startup if the endpoint is absent or unresponsive. Do not add ownership locks, identity handshakes, or protocol compatibility checks.
- [x] Stream plain logs and status without a terminal UI. Secondary disconnect does not stop the owner.
- [x] Reject startup options that would reconfigure the reused session. The endpoint record remains advisory.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

Implemented `dev-reuse.ts` and the `runDev` preflight. The canonical project root's
`.gsys/dev/supervisor.json` records only the last ready loopback URL through atomic
rename. A 1.5-second status probe precedes analysis, generation, builds, watchers,
and owned process startup. Missing, invalid, and unresponsive advisory records allow
new startup; invalid records report a diagnostic and filesystem read failures fail
clearly. URLs are restricted to literal IPv4 loopback HTTP ports with fixed request
paths, without redirects, credentials, identities, protocol versions, or locks.

Secondary invocations receive a current plain status snapshot and live logs. The
endpoint is ready when its listener and status are available, independently of
Worker readiness. Events and snapshots are bounded near 64 KiB, each secondary
output queue at 256 KiB, and connected log clients at 16. Client stdout uses stream
backpressure. Slow clients disconnect without stopping the owner. Logs, command
arguments, and environment variables are not persisted by this transport. Endpoint
records remain after shutdown to avoid deleting a concurrent owner's record.

The ticket 12 `hasStartupOptions` helper rejects supplied reconfiguration flags,
including matching values, before attaching. SIGINT/SIGTERM in a secondary process
only closes its connection. The owner closes the listener after its session stops.

Verification: Node.js 26.13.1 TypeScript no-emit check and compilation passed;
scoped oxfmt, oxlint, and `git diff --check` passed. Reviewed the native Node HTTP
and stream APIs at https://nodejs.org/api/http.html and
https://nodejs.org/api/stream.html. No tests, assertions, service runs, or runtime
transport checks were added or executed. Live logs have no replay buffer. The
advisory probe deliberately cannot guarantee a single supervisor per project.
