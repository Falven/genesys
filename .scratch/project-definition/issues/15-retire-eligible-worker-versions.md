# 15: Retire eligible Worker versions

**What to build:** Native retirement evidence permits graceful removal of previous Workers and unused builds while required versions remain available.

**Blocked by:** 14: Replace Workers after source changes.

**Status:** ready-for-agent

**State:** resolved

- [x] Keep readiness separate from retirement eligibility.
- [x] Retain versions needed by pinned Workflows. Account for supported native versioning APIs, evidence freshness, and unresolved native identity.
- [x] Do not change Current or Ramping versions, move pinned executions, or bypass native drainage.
- [x] Retire only with sufficient native evidence and preserve builds until the corresponding processes exit.
- [x] Explicit session shutdown remains separate from automatic retirement.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

Historical implementation notes below are superseded by the final review correction at the end of this ticket. The original automatic retirement claims were unsafe.

- `DevSession.watchWorkers` supplies the internal native decision function. The replacement coordinator checks fresh polling, source/build revisions, shutdown state, and process liveness before signaling. Explicit session shutdown remains separate. Builds stay referenced until the owned process tree exits.
- Native namespace/Worker enumeration records an observed snapshot. Missing, malformed, truncated, timed-out, or previously observed but missing instances remain unknown. This is not proof of delayed or heartbeat-disabled Workers or future capabilities. Authored Worker connections must match the managed service.
- Java's empty poller structures no longer prevent observed readiness. Positive successful polling establishes observed readiness; all prior active/successful task types must have fresh replacement coverage. Native mode requires fresh, unambiguous poller metadata. A heartbeat deployment label alone does not establish versioned mode.
- A ready replacement serving the same exact native version, namespace, queue, and observed task types permits retirement of the old replica while preserving required Current/Ramping/pinned versions. Proven unversioned replacements use this path under the author's registration/replay compatibility responsibility.
- A different deployment version requires exact native version identity, terminal Drained evidence with timestamps covering the routing change, and unchanged before/after routing reads. Current, Ramping, Draining, inactive-without-drainage, and unresolved versions remain retained. No routing or pinned execution mutations are sent.
- Legacy retirement reads raw `GetWorkerTaskReachability` for all associated queues, preserving omitted/unretrieved reachability. It then reads `DescribeTaskQueue` reachability across all task types for every associated queue. New/open/reachable evidence requires retention; missing/unsupported queue evidence remains unknown. Complete native unreachable or closed-only evidence permits retirement. Same-version replacement remains a separate replica path.
- Reports disclose terminal drainage's later pinned-override limitation, closed-Workflow Query needs, eventual consistency, and future inherited Build IDs on not-yet-associated queues. These do not become invented proof requirements about arbitrary future client calls.

Added exact `@temporalio/client` 1.25.0 for raw read-only API responses because the CLI's legacy reachability formatter drops SDK `TaskQueuesNotRetrieved`. The same bounded native API reads expose Workflow, Activity, and Nexus poller mode metadata. Connections use the managed local address, a five-second RPC deadline, cancellation, a four-MiB receive bound, and explicit close. The protobufjs postinstall only warns about version schemes; it is explicitly disabled in `allowBuilds`.

Primary-source inspection: [CLI 1.10 task-queue JSON](https://github.com/temporalio/cli/blob/v1.10.0/internal/temporalcli/commands.taskqueue.go), [CLI deployment JSON](https://github.com/temporalio/cli/blob/v1.10.0/internal/temporalcli/commands.worker.deployment.go), [lossy legacy formatter](https://github.com/temporalio/cli/blob/v1.10.0/internal/temporalcli/commands.taskqueue_get_build_id.go), [native reachability request/response](https://github.com/temporalio/api/blob/dc25bae9506a4d86cd180540cfd3188a535d994f/temporal/api/workflowservice/v1/request_response.proto), [native poller metadata](https://github.com/temporalio/api/blob/dc25bae9506a4d86cd180540cfd3188a535d994f/temporal/api/taskqueue/v1/message.proto), [drainage contract](https://github.com/temporalio/api/blob/dc25bae9506a4d86cd180540cfd3188a535d994f/temporal/api/deployment/v1/message.proto), [server poller aggregation](https://github.com/temporalio/temporal/blob/v1.32.2/service/matching/task_queue_partition_manager.go), and [Java heartbeat construction](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/worker/Worker.java).

Validation: frozen dependency installation, CLI typecheck/build, scoped oxfmt/oxlint, diff checks, native CLI help, and SDK/API/server source inspection. No tests, assertion harnesses, application runtime sessions, or Temporal servers were run. Runtime compatibility and SDK/server availability remain unverified; unavailable APIs retain Workers with a specific reason.

Premerge readiness correction: native heartbeat status must explicitly equal `WORKER_STATUS_RUNNING` (protobuf enum value 1). Shutting-down, shutdown, unspecified, absent, and unknown future statuses cannot establish readiness, even with fresh successful polls. The status is retained in each observation and checked again by `freshReadiness` before retirement. Verified against the native enum schema and the CLI's protobuf JSON output; typecheck and CLI build pass. No tests or runtime sessions ran.

Final review correction: State reopened. Native heartbeat enumeration cannot prove
complete coverage of arbitrary programs; disabled/delayed Workers can share an
owned process. Therefore no supported input currently permits automatic
whole-program retirement, including same-version replicas. This release retains
all predecessors until explicit session shutdown. The unsafe eligibility paths
were removed; native readiness observation and the coordinator's separate
retirement gate remain. Drained status alone cannot exclude later pinned
overrides or Queries of closed pinned Workflows, and closed-only reachability
requires retaining a version for those Queries. No application configuration or
readiness interface was introduced to claim otherwise. Ticket 15 remains open
until native evidence can establish complete relevant coverage and retirement
eligibility. See [review evidence](../review.md).

Bounded coverage completion (supersedes the blanket-unavailable conclusion above):
implemented and independently reviewed a positive native Go SDK 1.51.0 path on
POSIX with `CGO_ENABLED=0`. Typed closure analysis covers all linked application
code and callbacks. Source/context checks surround the exact native compile;
module verification, reviewed SDK checksum and binary digest bind the proof to
an unchanged direct launch. Actual child PID and creation time bind it to the
owned process. Paired fresh native observations must cover every expected remote
task type on one matching unversioned Worker per generation, namespace and queue.
Final membership/freshness and coordinator revision/liveness gates precede native
graceful shutdown. Build references remain until confirmed group completion.

The automatic-retirement criterion is now complete for this supported subset.
Arbitrary Go, Windows, other SDKs, startup overrides and all versioned Workers
retain unknown eligibility and remain until explicit session shutdown. No native
routing or pinned execution state is changed. The private snapshot must remain
unchanged by external actors, and the native toolchain/released libraries are
trusted. See [bounded Go coverage](../../../docs/sdk/go.md#bounded-retirement-coverage).

Validation: CLI build/typecheck, native Go helper compilation, scoped formatting
and lint, and the existing native example build with `CGO_ENABLED=0` passed. The
build emitted positive source/binary-bound coverage for `greetings` workflow and
activity task types. Both targeted reviewers confirmed the six proof-integration
findings were addressed. No tests, harnesses, assertions, Worker/Temporal sessions
or live retirement were run. Exact commands and proof identifiers are recorded
in [review evidence](../review.md).
