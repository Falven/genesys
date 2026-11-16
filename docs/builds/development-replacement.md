# Development replacement

A new `gsys dev` owner watches authored source, package manifests, lockfiles, and
other project inputs. Explicit native `--db-filename` paths (including `-f value`, `-f=value`, and `-fvalue`) and their SQLite
`-wal`, `-shm`, and `-journal` sidecars are excluded from watches and development
snapshots. Paths resolve from the original invocation directory; forwarded
Temporal arguments remain unchanged. Chokidar 6 uses native per-directory watching; its traversal
filter excludes generated and dependency subtrees before they acquire watches.
The first build waits for the initial scan. Symlink targets are not followed. A build,
selection, or startup error is reported without closing the watcher or stopping
Temporal and existing Workers. The next edit starts another build.

Edits are coalesced for 250 milliseconds. Only one build job runs at a time. An
edit during a build queues one later build; a superseded result cannot start a
new Worker or authorize retirement. Each build job runs in an owned process group
so native analysis tools, package commands, and their children are included in
session shutdown. The last successful build manifest remains authoritative.

`.gsys`, dependency directories, caches, and conventional native output paths are
excluded. `bin` and `obj` are excluded only under .NET package context; `build` is
excluded under Java, Python, or TypeScript package context. Ruby `bin` source is
watched. Generated registration headers and output paths recorded by completed
builds are also excluded, including native output paths outside `.gsys`.
Dependency source inside installed dependency directories does not trigger a
build; change the native manifest or lockfile to update those dependencies.
Recorded output paths are also unwatched when a build completes. Chokidar's
[documented filtering, backend, and lifecycle APIs](https://github.com/paulmillr/chokidar/blob/6.0.0/README.md)
provide traversal exclusion and asynchronous watcher closure.
Local authored helper files within the project remain inputs. Source outside the
project remains subject to the existing isolated-build restrictions.

Every successful candidate uses its own immutable source and registration build.
The same Worker selectors, executable overrides, and forwarded argument arrays
apply to each candidate. Native startup failure retains earlier Workers. A
running candidate with unknown readiness also leaves them active. Programs
removed from discovery have no replacement readiness evidence and remain active
until owner shutdown or a future native retirement decision permits removal.

Native observations must establish replacement polling readiness before the
internal retirement decision is consulted. The decision is asynchronous and is
checked again against the current source revision and live process states before
shutdown is requested. Unknown or failed retirement checks retain the previous
Worker. Automatic removal is supported only for the [checked Go subset](../sdk/go.md#bounded-retirement-coverage):
both generations must have a compiled single-Worker proof, an unchanged direct
POSIX launch, and fresh native unversioned evidence for the same namespace, queue
and every expected remote task type. The proof binds to the actual native child
PID and its creation time, not the supervisor's Node anchor. All evidence is
checked again after process membership reads and before graceful shutdown.

All other programs remain until explicit session shutdown. Native heartbeat
snapshots alone omit disabled or delayed Workers and cannot establish complete
program coverage. Windows, other SDKs, arbitrary Go programs, overridden launches
and versioned Workers have no automatic retirement path in this release.
Historical Drained status leaves later pinned overrides and closed-Workflow
Queries unresolved; closed-only reachability still needs the old version for
Queries. Genesys does not change Current/Ramping routing, move pinned executions,
or infer replay compatibility.
Unversioned overlapping Workers can receive tasks as soon as they poll, so native
registrations and replay behavior must be compatible or use native Worker
Versioning.

A build remains referenced by every live Worker process group that uses it.
Cleanup removes only snapshots created by this owner after their last process
group exits, and preserves the manifest-selected build. Shutdown closes the
watcher, cancels the in-flight build group, and requests native Worker shutdown.
Temporal remains alive until those groups exit. A watcher or source-filter error reports the native error, sets a failing exit
status, and stops the owned session through this same shutdown sequence. The CLI
does not claim to keep watching after that failure; correct the reported cause
and start `gsys dev` again. Generation, build, and Worker startup errors still
leave the healthy watcher active. A second interrupt force-stops owned groups. No additional graceful-shutdown deadline is imposed.

Validation covered TypeScript compilation, formatting, scoped lint, and a native
Go build through the internal build job. No tests, runtime replacement session,
readiness transition, or shutdown timing checks were run. Platform process
ownership limits remain those of the managed development supervisor.
