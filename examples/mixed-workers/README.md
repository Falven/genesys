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

Use Node.js 24 or newer, pnpm 12.17.0, Go 1.26 or newer, and Python 3.11 or newer.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
(cd examples/mixed-workers && go mod download)
node packages/genesys/dist/cli.js inspect examples/mixed-workers
node packages/genesys/dist/cli.js build examples/mixed-workers
```

Inspection reads source and native package metadata. It does not run authored
code. Before the first build, Go can report the missing generated import as a
warning. Python can report unresolved registration membership because the Worker
calls a generated function. The native build is authoritative. An empty Python
package initializer under `activities` can also report no static definitions.

Build copies both packages into one versioned project, writes generated
registration, builds the Go executable, and creates a Python virtual environment
in the nested package. It installs the package and its dependencies and compiles
the generated Python modules. Dependency installation can execute native build
code. The SDK versions are pinned; Python transitive dependencies and its build
backend retain normal package-manager resolution because this example has no lock.

Read `.gsys/compile/manifest.json` under the example to locate the published
`manifestPath`. That immutable manifest records both Worker source locations,
languages, build commands, startup commands, and generated artifacts. Each
`start.cwd`, executable, and Python `PYTHONPATH` refers to the same versioned build.
Keep the complete build at that path, including the virtual environment. Do not
substitute an installed application from the authored package or another build.

## Run the native programs

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

The CLI type check and native mixed build passed on macOS arm64 with Go 1.27.4
and Python 3.15.2. The published manifest and generated registration were reviewed.
No tests, test harnesses, assertion-based checks, Worker startup, or Temporal
Workflow executions were run. These checks do not establish runtime compatibility
on other operating systems or SDK versions.
