---
title: "Mixed-Language Projects"
description: "Build Go and Python Workers in one project and start each native program independently."
---

Keep each language's package metadata with its source. Genesys inventories the project, assigns
entries to their native package context, and generates registration for each package. A build uses
one versioned workspace and publishes the Worker startup plans together after the native build
commands succeed. If a native build fails, the previous successful build stays selected.

## Choose package boundaries

| Language   | Native package context                         | Registration and launch details              |
| ---------- | ---------------------------------------------- | -------------------------------------------- |
| Go         | `go.mod`, native module/workspace rules        | [Go](../reference/sdk/go.md)                 |
| Java       | Maven or Gradle package                        | [Java](../reference/sdk/java.md)             |
| .NET       | Native project file                            | [.NET](../reference/sdk/dotnet.md)           |
| PHP        | Composer package and RoadRunner configuration  | [PHP](../reference/sdk/php.md)               |
| Python     | Python package metadata or dependency manifest | [Python](../reference/sdk/python.md)         |
| Ruby       | Gemfile or gemspec                             | [Ruby](../reference/sdk/ruby.md)             |
| Rust       | Cargo package and targets                      | [Rust](../reference/sdk/rust.md)             |
| TypeScript | `package.json`, native compiler settings       | [TypeScript](../reference/sdk/typescript.md) |

Native tools resolve imports, visibility, dependencies, compilation, and runtime libraries. A
nested directory can still participate in its parent package through .NET compile globs, Cargo
modules, or TypeScript imports. Genesys gives each adapter its owned registration entries while
retaining project source for import resolution. Java excludes nested independent Java packages
from source and module analysis. PHP uses its own Composer package's RoadRunner configuration.
Ruby can follow literal `require_relative` references into another package without registering
its entries. Python can resolve imports across package boundaries and keep each package's
Worker registration scope separate.

Construct dependencies in native application code and pass existing instances to generated
registration. When static analysis cannot resolve a form, use explicit native assembly. Workers
may reuse a native identity in separate registration scopes. Give Worker selectors unique names
across the project so Genesys can select the intended program. Each Worker chooses its own Task
Queues, deployment, and SDK options.

Cross-language calls use native Temporal Workflow, Activity, or Nexus mechanisms where the SDKs
support them. Callers and implementations must agree on native names and serialized payloads.
Genesys cannot verify payload or replay compatibility from source.

## Build a Go Workflow and a Python Activity Worker

This example runs two native programs on the `greetings` Task Queue.

| Worker         | Package context                     | Definitions                                          | Polls for      |
| -------------- | ----------------------------------- | ---------------------------------------------------- | -------------- |
| `orchestrator` | Root Go module                      | `Greeting` Workflow                                  | Workflow Tasks |
| `greeter`      | Nested `enrichment/` Python package | `ComposeGreeting` and `UppercaseGreeting` Activities | Activity Tasks |

The Go Workflow calls the Activities by their native names. Both SDKs use their default
`json/plain` converter for these strings. The Go Worker sets `LocalActivityWorkerOnly: true` to
disable remote Activity polling. The Python Worker constructs one `Greeter("Hello")` and uses its
two bound methods through generated registration. Both programs choose their own Task Queue and
connection settings.

Use an installed `gsys`, Go 1.26 or later, and Python 3.11 or later with `venv` and `pip`. The
commands below use a POSIX shell and `jq`. Install the Temporal CLI to run the development
session and execute the Workflow. See [Getting Started](../getting-started.md) for CLI installation.

### Create the source files

Create this layout. The `__init__.py` files are empty.

```text
mixed-workers/
├── go.mod
├── temporal/
│   ├── workflows/
│   │   └── greeting.go
│   └── workers/
│       └── orchestrator/
│           └── main.go
└── enrichment/
    ├── pyproject.toml
    └── src/
        └── greetings/
            ├── __init__.py
            └── temporal/
                ├── __init__.py
                ├── activities/
                │   ├── __init__.py
                │   └── greeting.py
                └── workers/
                    ├── __init__.py
                    └── greeter/
                        ├── __init__.py
                        └── main.py
```

Create `go.mod`.

```go
module example.com/mixed-workers

go 1.26.0

require go.temporal.io/sdk v1.51.0
```

Create `temporal/workflows/greeting.go`.

```go
package workflows

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

func Greeting(ctx workflow.Context, name string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           "greetings",
		StartToCloseTimeout: 10 * time.Second,
	})
	var greeting string
	if err := workflow.ExecuteActivity(ctx, "ComposeGreeting", name).Get(ctx, &greeting); err != nil {
		return "", err
	}
	var result string
	err := workflow.ExecuteActivity(ctx, "UppercaseGreeting", greeting).Get(ctx, &result)
	return result, err
}
```

Create `temporal/workers/orchestrator/main.go`.

```go
package main

import (
	"log"
	"os"
	"time"

	"example.com/mixed-workers/temporal/gsysregistration"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	c, err := client.Dial(client.Options{
		HostPort:  os.Getenv("TEMPORAL_ADDRESS"),
		Namespace: os.Getenv("TEMPORAL_NAMESPACE"),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	w := worker.New(c, "greetings", worker.Options{
		WorkerStopTimeout:       30 * time.Second,
		LocalActivityWorkerOnly: true,
	})
	gsysregistration.Register(w)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Print(err)
		c.Close()
		os.Exit(1)
	}
}
```

Create `enrichment/pyproject.toml`.

```toml
[build-system]
requires = ["setuptools>=80"]
build-backend = "setuptools.build_meta"

[project]
name = "genesys-mixed-greetings"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["temporalio==1.36.1"]

[tool.setuptools.packages.find]
where = ["src"]
```

Create `enrichment/src/greetings/temporal/activities/greeting.py`.

```python
from temporalio import activity


class Greeter:
    def __init__(self, salutation: str) -> None:
        self.salutation = salutation

    @activity.defn(name="ComposeGreeting")
    async def compose(self, name: str) -> str:
        return f"{self.salutation}, {name}!"

    @activity.defn(name="UppercaseGreeting")
    async def uppercase(self, greeting: str) -> str:
        return greeting.upper()
```

Create `enrichment/src/greetings/temporal/workers/greeter/main.py`.

```python
import asyncio
import logging
import os
import signal
from datetime import timedelta

from temporalio.client import Client
from temporalio.worker import Worker

from greetings.temporal.activities.greeting import Greeter
from gsys_generated_84f738e1198c.activities import registrations


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        signal.signal(event, lambda *_: loop.call_soon_threadsafe(stopped.set))
    async with Worker(
        client,
        task_queue="greetings",
        activities=registrations(Greeter("Hello")),
        graceful_shutdown_timeout=timedelta(seconds=30),
    ):
        await stopped.wait()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

Genesys creates the imported Go and Python registration during the build. For a different
Python discovery-root path, use the module listed under `collections` in the build's
`.gsys/compile/python/<package hash>/registration.json`. The paths can change without changing
the Activity names.

### Inspect and build

From the directory that contains `mixed-workers/`, install the Go SDK dependencies, inspect the
source, and build both native programs.

```bash
(cd mixed-workers && go get go.temporal.io/sdk/client@v1.51.0 go.temporal.io/sdk/worker@v1.51.0 go.temporal.io/sdk/workflow@v1.51.0)
gsys inspect mixed-workers
gsys build mixed-workers
```

Inspection reports entries, definitions, package context, and Worker candidates. Before
generation, Go can report the missing registration import. Python can report unresolved Worker
membership because the Worker calls a generated function. The empty Activity package initializer
can also report that it contains no definitions.

The build links Go registration into the `orchestrator` executable. Python uses `venv` and
`pip install .` to install the application in `enrichment/` and compiles the generated
registration. This example pins both SDK versions. Python build backend and transitive
dependencies follow pip's unlocked resolution.

Read the current selector once. Use its immutable `manifestPath` for both Workers.

```bash
manifest=$(jq -er '.manifestPath' mixed-workers/.gsys/compile/manifest.json)
jq '{id, root, metadataPath, workers: [.workers[] | {name, nativeOutput, start}]}' "$manifest"
```

The manifest lists the two native outputs and their startup commands. Paths in
`nativeOutput.paths` are relative to the manifest's `root`. The file at `metadataPath` records
the build inputs, tool versions, and build host.

### Execute the Workflow

With the Temporal CLI on `PATH`, run `gsys dev mixed-workers`. Genesys starts the managed
Temporal development server and both Worker programs. In another terminal, run:

```bash
temporal workflow execute --address localhost:7233 --namespace default \
  --type Greeting --task-queue greetings --input '"Ada"'
```

The expected result is `"HELLO, ADA!"`. Press Ctrl+C in the terminal running `gsys dev` to
stop the session. When you change the server address or namespace, supply matching
`TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE` values to the native Workers.

## Deploy the native programs independently

One build can supply separate Worker applications. Release the Go executable with its required
runtime files and libraries on the recorded OS and CPU. For Python, keep the package, generated
registration, and virtual environment at the workspace's original absolute path, with the
compatible base Python installation and system libraries. The package installed by pip alone
does not include generated registration. Declare any shared libraries through native package
tools.

To start the two programs outside `gsys dev`, use an available Temporal Service and set
`manifest` in each terminal to the same immutable path. For `orchestrator`, start the executable
with no arguments.

```bash
go_cwd=$(jq -er '.workers[] | select(.name == "orchestrator") | .start.cwd' "$manifest")
go_exe=$(jq -er '.workers[] | select(.name == "orchestrator") | .start.executable' "$manifest")
(cd "$go_cwd" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default "$go_exe")
```

For `greeter`, preserve both argument boundaries and the Python import path.

```bash
py_cwd=$(jq -er '.workers[] | select(.name == "greeter") | .start.cwd' "$manifest")
py_exe=$(jq -er '.workers[] | select(.name == "greeter") | .start.executable' "$manifest")
py_flag=$(jq -er '.workers[] | select(.name == "greeter") | .start.args[0]' "$manifest")
py_module=$(jq -er '.workers[] | select(.name == "greeter") | .start.args[1]' "$manifest")
py_path=$(jq -er '.workers[] | select(.name == "greeter") | .start.env.PYTHONPATH' "$manifest")
(cd "$py_cwd" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default \
  PYTHONPATH="$py_path" "$py_exe" "$py_flag" "$py_module")
```

Keep the immutable workspace while a running program, an external consumer, or a retained
Worker version needs it. Native readiness requires polling evidence for each Worker, and
retirement requires separate evidence. See [Versioned Builds](builds.md) and
[Native Worker Deployment](deployment.md).

## Validation

On macOS arm64, the example built with Go 1.27.4, Python 3.15.2, and Node.js 26.13.1.
With Temporal CLI 1.10.1 and Temporal Server 1.32.2, `gsys dev` started both Workers.
Both bound Activities ran on the Python Worker, and the `Greeting` Workflow returned
`"HELLO, ADA!"`. The session shut down cleanly.
