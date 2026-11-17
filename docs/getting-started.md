---
title: "Getting Started"
description: "Install Genesys, build a native Go Worker, and execute a Temporal Workflow."
---

Create a Go Worker that runs the `Greeting` Workflow and its `Greet` Activity. You will inspect the
source, build the Worker, and run it with a managed Temporal development server.

## Prerequisites

- Node.js 24 or later for `gsys`
- Go 1.26 or later for the analyzer and the Worker
- The Temporal CLI on `PATH` for `gsys dev` and for starting the Workflow
- pnpm 12.17.0 if you build the CLI from source

## Get the CLI

To install a released version in your npm project, run `npm install @gsys/cli`.
If you have a Genesys package tarball, install it with the path to that file.

```bash
npm install /absolute/path/to/genesys-cli.tgz
```

From your npm project, use `node node_modules/@gsys/cli/dist/cli.js` in place of `gsys` in
the examples below. If you already have a global installation, use `gsys` directly.

To build the CLI from source, run these commands from the root of the Genesys checkout.

```bash
pnpm install --frozen-lockfile
pnpm --filter @gsys/cli build
node packages/genesys/dist/cli.js --help
```

Use `node /absolute/path/to/genesys/packages/genesys/dist/cli.js` in place of `gsys` in the
examples below. To create an installable tarball from the same checkout, run
`pnpm --filter @gsys/cli pack` and use the path it prints in the install command above.

Run `gsys --help` using your CLI to check the installation. The usage lists `inspect`, `build`,
and `dev`.

## Create the project

Create `native-workers/` with the following files. Keep your terminal in its parent directory for
the commands that follow.

```text
native-workers/
├── go.mod
└── temporal/
    ├── activities/
    │   └── greeting.go
    ├── workflows/
    │   └── greeting.go
    └── workers/
        └── greeting/
            └── main.go
```

Create `native-workers/go.mod` with the module path the example imports.

```go
module example.com/native-workers

go 1.26.0

require go.temporal.io/sdk v1.51.0
```

Load the Go SDK packages and record their dependencies. The command updates `go.mod` and creates
`go.sum`.

```bash
(cd native-workers && go get go.temporal.io/sdk/client@v1.51.0 go.temporal.io/sdk/worker@v1.51.0 go.temporal.io/sdk/workflow@v1.51.0)
```

Add the Activity at `native-workers/temporal/activities/greeting.go`.

```go
package activities

import "context"

func Greet(_ context.Context, name string) (string, error) {
	return "Hello, " + name + "!", nil
}
```

Add the Workflow at `native-workers/temporal/workflows/greeting.go`.

```go
package workflows

import (
	"time"

	"example.com/native-workers/temporal/activities"
	"go.temporal.io/sdk/workflow"
)

func Greeting(ctx workflow.Context, name string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
	})
	var result string
	err := workflow.ExecuteActivity(ctx, activities.Greet, name).Get(ctx, &result)
	return result, err
}
```

Add the Worker at `native-workers/temporal/workers/greeting/main.go`. This program chooses the
`greetings` Task Queue and calls `gsysregistration.Register`. Genesys creates the imported
registration package in the build.

```go
package main

import (
	"log"
	"os"
	"time"

	"example.com/native-workers/temporal/gsysregistration"
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
		WorkerStopTimeout: 30 * time.Second,
	})
	gsysregistration.Register(w)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Print(err)
		c.Close()
		os.Exit(1)
	}
}
```

## Inspect the project

```bash
gsys inspect native-workers
```

The JSON output lists entries for the three Go files, definitions named `Greeting` and `Greet`,
and a Worker program named `greeting`. Genesys writes the source manifest and diagnostics to
`native-workers/.gsys/discovery/`. Go analysis reads native package and type information without
running your Worker. It can report the missing `gsysregistration` import before generation.

## Build the Worker

```bash
gsys build native-workers
```

Genesys generates registration and compiles the Worker in a versioned snapshot.
`native-workers/.gsys/compile/manifest.json` selects the successful build. The build's manifest
lists the Worker executable and the generated registration files.

## Run the Worker and execute a Workflow

```bash
gsys dev native-workers
```

Genesys starts the managed Temporal server and the `greeting` Worker. Leave the session running.
When the Worker reports that it has started, open a second terminal and execute the Workflow.

```bash
temporal workflow execute --address localhost:7233 --namespace default \
  --type Greeting --task-queue greetings --input '"Ada"'
```

The result is `"Hello, Ada!"`. Press Ctrl+C in the terminal running `gsys dev` to stop the Worker
and then the managed server.

## Next steps

- See how Genesys assigns entries to native packages in [Project Structure](concepts/project-structure.md).
- Choose how your Worker consumes generated code in [Native Registration](concepts/native-registration.md).
- Start the built Worker through your own tooling in [Native Worker Deployment](guides/deployment.md).
- Follow [Mixed-Language Projects](guides/mixed-language-projects.md) to use more than one SDK language.
