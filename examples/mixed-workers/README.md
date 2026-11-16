# Mixed native Workers

This project builds a Go Workflow Worker and a Python Activity Worker together.
The Go module is the project root. The Python package is nested at `enrichment/`.
Each Worker imports its generated registration once and owns its SDK options.

| Worker         | Native package              | Definitions                                       | Native working directory |
| -------------- | --------------------------- | ------------------------------------------------- | ------------------------ |
| `orchestrator` | `go.mod`                    | `Greeting` Workflow                               | Versioned project root   |
| `greeter`      | `enrichment/pyproject.toml` | `ComposeGreeting`, `UppercaseGreeting` Activities | Versioned `enrichment/`  |

Both Workers use the authored `greetings` Task Queue. The Go Worker registers only
Workflows and sets native `LocalActivityWorkerOnly: true` to disable remote
Activity polling; the Python Worker registers only Activities. Temporal routes their
separate task types. Language does not determine a queue or deployment group.

`Greeting` sends a string to `ComposeGreeting`, then passes the returned string to
`UppercaseGreeting`. The Go calls use native Activity names and Activity options.
The Python decorators declare those exact names. Both SDK default converters use
`json/plain` for these strings. This agreement follows the released
[Go converter](https://github.com/temporalio/sdk-go/blob/v1.51.0/converter/json_payload_converter.go)
and [Python converter](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/converter/_payload_converter.py)
implementations. No schema generator, transport wrapper, or shared runtime is used.

The Python Worker constructs one `Greeter("Hello")`. Generated
`registrations(instance)` returns both bound methods. Adding another decorated
method updates that collection without changing an authored registration list.
The generated module name is recorded in
`.gsys/compile/python/<package hash>/registration.json` inside the published build.
Its path-derived import is tooling output; the native Activity names remain stable
when source moves. If the discovery root moves, update the Worker import to the
new generated module recorded by inspection/build output.

## Build and inspect

Use Node.js 24 or newer, pnpm 12.17.0, Go 1.26 or newer, Python 3.11 or newer,
and `jq`. Run these commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
(cd examples/mixed-workers && go mod download)
node packages/genesys/dist/cli.js inspect examples/mixed-workers
node packages/genesys/dist/cli.js build examples/mixed-workers
```

With the CLI installed, use `gsys build examples/mixed-workers` for the last command.

Inspection reads source and native package metadata. It does not run authored
code. Before the first build, Go can report the missing generated import as a
warning. Python can report unresolved registration membership because the Worker
calls a generated function. The native build is authoritative. An empty Python
package initializer under `activities` can also report no static definitions.

Both outputs share one versioned project. Go resolves module dependencies from
`go.mod` and checks their hashes against `go.sum`. It links the generated Workflow
registration into the `orchestrator` executable. Python uses `venv` and
`pip install .` in `enrichment/` to install the application and its dependencies.
The build also compiles the generated Python registration. Dependency installation
can execute native build code. Both SDK versions are pinned. The Python build
backend and transitive dependencies follow pip's normal resolution because this
example has no lockfile.

Read the current selector once. Use its immutable `manifestPath` for both Workers.
The manifest records their build and startup commands and their `nativeOutput`
records. Output paths are relative to the manifest's `root`. The file at
`metadataPath` records build inputs, tool versions, and the build host.

```sh
manifest=$(jq -er '.manifestPath' examples/mixed-workers/.gsys/compile/manifest.json)
jq '{id, root, metadataPath, workers: [.workers[] | {name, nativeOutput, start}]}' "$manifest"
```

## Distribute the applications independently

This example publishes `orchestrator` and `greeter` as separate native outputs.
You choose what to distribute or release together. The workspace, package
manifests, and shared Task Queue impose no application grouping. If applications
share a library, declare it through the native package tools and include any local
source in the selected workspace. Those tools resolve and include dependencies
according to each application's build settings.

- For `orchestrator`, distribute the Go executable for the recorded platform and
  architecture. Supply any dynamic libraries required by the selected Go build
  settings. The executable includes the Workflow and the registration it uses.
- For `greeter`, keep the published `enrichment/` directory with its source and
  installed virtual environment, plus the generated registration directory
  listed in `nativeOutput.paths`. Preserve the workspace's original absolute path
  and the relative layout. Supply the compatible base Python installation the
  virtual environment refers to, and the system libraries the installed packages
  require. The package installed by pip alone omits the generated registration.

An author-owned build task can call `gsys build` and then inspect or stage one
output. For example, add these commands to a task that records the Go executable's
module dependencies and build settings for release. The build also works on its own.

```sh
gsys build examples/mixed-workers &&
  manifest=$(jq -er '.manifestPath' examples/mixed-workers/.gsys/compile/manifest.json) &&
  go_exe=$(jq -er '.workers[] | select(.name == "orchestrator") | .start.executable' "$manifest") &&
  go version -m "$go_exe"
```

## Start the native programs directly

Use a running Temporal Service and supply its address and namespace at startup.
The commands below use local defaults. In each terminal, set `manifest` to the
same immutable path selected above. Use the recorded working directory,
executable, arguments, and environment for each Worker.

Start `orchestrator`. Its recorded argument list is empty.

```sh
go_cwd=$(jq -er '.workers[] | select(.name == "orchestrator") | .start.cwd' "$manifest")
go_exe=$(jq -er '.workers[] | select(.name == "orchestrator") | .start.executable' "$manifest")
(cd "$go_cwd" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default "$go_exe")
```

Start `greeter`. Read its two recorded arguments separately to preserve their
boundaries. Its `PYTHONPATH` includes the application source and generated registration.

```sh
py_cwd=$(jq -er '.workers[] | select(.name == "greeter") | .start.cwd' "$manifest")
py_exe=$(jq -er '.workers[] | select(.name == "greeter") | .start.executable' "$manifest")
py_flag=$(jq -er '.workers[] | select(.name == "greeter") | .start.args[0]' "$manifest")
py_module=$(jq -er '.workers[] | select(.name == "greeter") | .start.args[1]' "$manifest")
py_path=$(jq -er '.workers[] | select(.name == "greeter") | .start.env.PYTHONPATH' "$manifest")
(cd "$py_cwd" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default \
  PYTHONPATH="$py_path" "$py_exe" "$py_flag" "$py_module")
```

These processes run independently. The `Greeting` Workflow needs an Activity
Worker that serves both Activity names on `greetings`. Keep each immutable build
while a running process, an external consumer, or a retained Worker version
requires its files. Successful compilation and installation establish build
completion. Native polling and retirement require separate evidence.
See [versioned builds](../../docs/builds/versioned-builds.md) and
[deployment](../../docs/deployment.md).

## Run the development session

With the Temporal CLI installed, run from the repository root:

```sh
node packages/genesys/dist/cli.js dev examples/mixed-workers
```

This starts the managed Temporal development server and both native Workers. In a
second terminal, submit a Workflow with the native Temporal CLI:

```sh
temporal workflow execute --type Greeting --task-queue greetings --input '"Ada"'
```

The expected application result is `"HELLO, ADA!"`. This runtime exchange has not
been executed as part of the implementation checks. Both native programs read
`TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE`; their defaults match the local server.
If server connection flags change, configure these application values to match.
Server arguments do not change Worker connection settings automatically.

Ctrl+C stops the owned session. Each Worker uses its native shutdown behavior;
the Python Activity shutdown interval and Go Worker stop timeout are 30 seconds.
A direct process manager can use the published `start` commands instead. Preserve
argument boundaries, `cwd`, and environment values. See
[deployment](../../docs/deployment.md) for process ownership and build reuse.

Build success does not establish polling readiness or authorize retirement.
Inspection reports unavailable whole-program readiness where native evidence is
incomplete. The supervisor can observe native Worker evidence, while missing
coverage or version-retirement evidence keeps previous Workers and builds retained.

## Validation

The CLI build and native mixed build passed on macOS arm64 with Go 1.27.4
and Python 3.15.2. Inspection covered the immutable manifest and build metadata,
the Go executable and its compiled registration, and the Python registration,
virtual environment, and installed application and dependencies.
No tests, test harnesses, assertion-based checks, Worker startup, or Temporal
Workflow executions were run. These checks do not establish runtime compatibility
on other operating systems or SDK versions.
