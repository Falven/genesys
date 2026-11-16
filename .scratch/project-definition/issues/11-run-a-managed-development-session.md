# 11: Run a managed development session

**What to build:** A new gsys dev session starts managed Temporal and all discovered native Worker programs with plain process logs.

**Blocked by:** 10: Publish complete versioned builds.

**Status:** ready-for-agent

**State:** resolved

- [x] Use the same all-Worker behavior in interactive and noninteractive environments without prompts.
- [x] Start the managed Temporal development server with native temporary-state defaults. Do not add a server-selection mode.
- [x] Report native readiness beyond process creation. Report missing evidence without inventing readiness.
- [x] Own process lifecycle and print startup failures and process errors.
- [x] Request native graceful Worker shutdown before stopping Temporal. Respect native shutdown settings. A second interrupt forces owned processes only.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

- Added default `gsys dev`: start managed `temporal server start-dev` with native temporary-state defaults, publish the isolated build, then start every published Worker command in its build working directory. No prompts or terminal UI.
- Added session hooks for argument selection, supervisor reuse, watch/replacement, and native retirement. A session can start managed Temporal before its first successful build; later tickets own watch/recovery and reuse orchestration.
- Added bounded native namespace/Worker enumeration and Worker description. CLI queries use the explicit managed address and namespaces with ambient configuration disabled. Heartbeats must match local hostname, an owned live PID, and process-generation start time. Recent heartbeat plus successful native polls reports readiness for observed task types and instances. Complete-program coverage and absent versioning evidence stay unknown. Startup logs and process creation never establish Worker readiness.
- POSIX launch uses a separate owned process group per Worker and managed server. Native ownership facility is checked before launch. First interrupt requests Worker SIGINT, waits for the complete owned group without a new deadline, then requests Temporal SIGINT. Second interrupt force-signals only owned groups. Unexpected startup/process failures are printed. Existing occupied endpoints are rejected without changing their services.
- Validation: `pnpm --filter @genesys/cli build`, `pnpm --filter @genesys/cli typecheck`, scoped `pnpm exec oxfmt`, scoped `pnpm exec oxlint`, and `git diff --check` passed. Read installed Temporal CLI 1.10.0 help and current official API/CLI source. No tests, test harnesses, business Workflows, application runs, or live service runs were added or executed.
- Platform limit assigned to ticket 18: Windows startup fails before spawning because native Windows console control and owned process-tree support are not implemented here. It never labels Node's forceful Windows SIGINT as graceful. macOS/Linux shutdown behavior was reviewed and typechecked, not runtime-verified. Authored programs must implement their native graceful signal handler and remain in their owned process group; daemonized programs that escape that group are outside the established ownership evidence.
- Native source references: [Worker heartbeat schema](https://github.com/temporalio/api/blob/master/temporal/api/worker/v1/message.proto), [CLI Worker JSON output](https://github.com/temporalio/cli/blob/main/internal/temporalcli/commands.worker.go), [Node process ownership and signals](https://nodejs.org/api/child_process.html). CLI `worker describe` prints `WorkerInfo` directly; older CLI Worker lists contain `WorkerInfo`, while newer native APIs expose flattened `WorkerListInfo`. Both list shapes are parsed.

- Shutdown cancellation is passed to native observation subprocesses and enumeration loops. Read-only query processes use bounded execution and immediate termination on cancellation; cancelled observation does not emit a failure.

Final review correction supersedes the earlier POSIX PID-polling mechanism: a bundled live group anchor now holds lifetime ownership and signals only its own group through IPC requests. Native leader exit does not release ownership. Force termination or anchor failure is unknown completion and retains builds. CLI compilation/package inspection passed; live lifecycle behavior remains unverified. See [final review evidence](../review.md).
