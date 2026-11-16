---
title: "Development"
description: "Inspect a project, launch native Workers, and manage a Genesys development session."
---

Run `gsys dev` to build and run native Worker programs against a managed Temporal development
server. The invocation that starts the session owns the server, the source watcher, build jobs,
and Worker processes. Later invocations can reuse the supervisor to read status and live logs.

## Inspect and start the project

Install the Temporal CLI on your `PATH` and the native tools and dependencies for the SDKs in
your project. The commands below use the completed Go project from [Getting
Started](../getting-started.md). Run them from the parent of `native-workers/`.

```bash
gsys inspect native-workers
gsys dev native-workers --worker greeting
```

Look for `greeting` under `workers` in the inspection output. The selection uses the Worker name
from the named Worker directory. The Go program sets its Task Queue to `greetings`. Omit
`--worker` to start all discovered programs, or repeat it to select several. Genesys builds the
project before applying the Worker selection.

The owner starts Temporal, exposes its supervisor endpoint, and waits for the first source scan
before starting the initial build. Each Worker starts from its native package directory inside
the isolated build. Look for log labels such as `[temporal]`, `[build]`, and
`[greeting@<build-id>]`. Verify that the Worker polls by [running the example Workflow](../getting-started.md#run-the-worker-and-execute-a-workflow).

If inspection finds a Worker without a launch plan, check the source-linked diagnostic and the
[SDK reference](../reference/sdk/index.md). Supply a native executable with
`--worker-exec=<name>:<executable>` when you need a different entrypoint. This replaces the
inferred command. Use `--worker-arg=<name>:<argument>` for each argument the program expects.
See the [CLI reference](../reference/cli/index.md#gsys-dev) for argument order and quoting.

### Configure the managed Temporal server

Put Temporal CLI arguments after `--`. For example, start the example session on an alternate
port with a persistent SQLite file.

```bash
TEMPORAL_ADDRESS=localhost:7234 gsys dev native-workers --worker greeting -- \
  --port 7234 --db-filename ./temporal.db
```

The Go example reads `TEMPORAL_ADDRESS` from its environment. Use the matching address when
running the example Workflow. In your own program, set the connection and Namespace through your
native SDK configuration. Relative server paths such as `./temporal.db` use the original
invocation directory. Genesys forwards the server arguments directly to `temporal server start-dev`.

For known bind addresses, Genesys checks that the endpoint is free before launch and waits for
Temporal to report healthy. The default address used for observation is `localhost:7233`. A
native configuration that prevents Genesys from resolving the endpoint leaves service readiness
unknown. To run Workers against a service you manage, use [Native Worker Deployment](deployment.md).

## Reuse a running supervisor

From a second terminal, pass the same project directory without startup options.

```bash
gsys dev native-workers
```

The secondary invocation checks `.gsys/dev/supervisor.json` before analysis, builds, watching, or
process startup. A responding supervisor supplies a status snapshot and streams live plain logs.
An available endpoint confirms that the supervisor can report status. Check the Worker readiness
messages for evidence of polling. The stream starts with current status and events as they happen.
It accepts up to 16 log clients, truncates large events near 64 KiB, and disconnects clients whose
pending output exceeds 256 KiB.

All startup options are rejected during reuse, even if their values match the owner invocation.
To change the selection or configuration, interrupt the owner, wait for shutdown, and start a
new session with the new options. Interrupting the secondary terminal only disconnects that client.

The endpoint record contains the last ready loopback URL and stays on disk after shutdown.
An absent or unresponsive endpoint permits a new start. Concurrent starts can produce separate
supervisors because the record is advisory. An invalid record produces a diagnostic and is
ignored. A filesystem read error stops the invocation.

## Work with source changes

The owner watches authored source, package manifests, lockfiles, and local helper files. Genesys
excludes `.gsys`, dependency directories, caches, generated registration, and recorded native
outputs. It also excludes `bin/` and `obj/` in .NET package contexts and `build/` in Java, Python,
and TypeScript package contexts. Ruby `bin/` source remains an input. The watcher skips symlink
targets. Update a package manifest or lockfile to pick up dependency changes.

The explicitly configured Temporal database file and its SQLite `-wal`, `-shm`, and `-journal`
files are excluded from watches and development snapshots. This applies to `--db-filename` and
its `-f` forms (`-f value`, `-f=value`, and `-fvalue`).

Genesys groups edits within 250 milliseconds and runs one owned build job at a time. An edit
during a build queues another build. A result superseded before launch is skipped. If an edit
supersedes a candidate during startup, that candidate cannot authorize retirement. Each
candidate uses its own source and registration snapshot and the original Worker selection and
startup options.

Build, selection, and Worker startup errors leave the watcher, Temporal, and earlier Workers
active. Correct the reported problem and edit the source to retry. A failed build keeps the last
published build selected. The manifest tracks successful build publication even if development
selection or Worker startup later fails. A watcher or source-filter error stops the owned session
with a failing exit status. Correct that error and run `gsys dev` again.

## Understand readiness and retirement

Readiness describes a replacement Worker that is polling. Genesys uses fresh native heartbeat
and successful polling evidence that it can attribute to the native process. Process startup,
supervisor status, and startup logs alone leave readiness unknown.

Retirement determines whether Genesys can request shutdown of the prior Worker. Genesys checks
retirement separately after the replacement is ready, then rechecks the current source revision
and both process states before requesting shutdown. Unknown or failed checks retain the prior
Worker. Removing a program from discovery leaves it without a replacement and it remains active
until the owner shuts down.

Automatic retirement is available only for the [bounded Go
subset](../reference/sdk/go.md#bounded-retirement-coverage). Both builds need a compiled single-Worker proof
and an unchanged direct POSIX launch without Worker overrides or extra arguments. Genesys must
match each native child by PID and creation time and see fresh, complete unversioned polling
evidence on the same Namespace and Task Queue for every expected remote task type. See the Go
reference for exact SDK and build settings.

Other SDKs, Windows launches, arbitrary Go programs, and versioned Workers stay active until
session shutdown. Heartbeat snapshots can omit delayed or disabled Workers, so complete program
coverage needs stronger evidence. Native drainage history alone leaves pinned overrides and
closed-Workflow Queries unresolved. Applications retain control of version routing and replay
compatibility. Overlapping unversioned Workers can receive tasks as soon as they poll. Keep
native registrations and replay behavior compatible or use native Worker Versioning.

See the [readiness and retirement decision](../adr/0002-separate-readiness-from-retirement.md).

## Stop the session

Press Ctrl+C in the owner terminal. Genesys closes the watcher, cancels the in-flight build job,
and requests native Worker shutdown. Managed Temporal stays available while the owned Worker
groups exit. Their native shutdown handlers determine how long this takes. Genesys waits without
a deadline. A second interrupt requests forced termination of the owned processes. If managed
Temporal exits unexpectedly, Genesys stops its Workers and reports a failure.

A build stays referenced while any owned Worker process group uses it. The owner removes only
its own snapshots after the last group exits and preserves the manifest-selected build. See
[Platform Support](../reference/platforms.md) for process ownership on your host and [Versioned
Builds](builds.md) for retention.
