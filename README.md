<div align="center">
  <h1>Genesys</h1>

<a href="package.json"><img alt="Node.js 24 or later" src="https://img.shields.io/badge/Node.js-24%2B-339933.svg?style=for-the-badge&logo=nodedotjs&labelColor=000000"></a>
<a href="docs/sdk-support.md"><img alt="Native Temporal SDKs" src="https://img.shields.io/badge/Temporal-native%20SDKs-000000.svg?style=for-the-badge&labelColor=000000"></a>
<a href="docs/platforms.md"><img alt="Platform support" src="https://img.shields.io/badge/Platform-support-blueviolet.svg?style=for-the-badge&labelColor=000000"></a>

</div>

Genesys uses directory conventions to discover native Temporal Workflows, Activities, Nexus services,
and Worker programs. It generates native registration, builds isolated versions, and supervises local
development. Applications keep their native SDK configuration, Task Queues, and Worker lifecycle.

## The filesystem is the authoring interface

A typical Genesys project has this structure:

```text
my-project/
├── go.mod                     # Native package manifest and dependencies
└── temporal/                  # Discovery root
    ├── workflows/             # Native Workflow definitions
    │   └── greeting.go
    ├── activities/            # Native Activity definitions
    │   └── greeting.go
    ├── nexus/                 # Optional: native Nexus service handlers
    │   └── service.go
    └── workers/               # Native Worker programs
        └── greeting/
            └── main.go
```

Discovery roots can appear at any package depth. Genesys has adapters for Go, Java, .NET, PHP,
Python, Ruby, Rust, and TypeScript. Each package keeps its native dependencies and build tools.
Read the [SDK support matrix](docs/sdk-support.md) for supported forms and limits, and the
[mixed-language guide](docs/mixed-language-projects.md) for project layout and registration.

## Quick start

Use Node.js 24 or later, pnpm 12.17.0, Go 1.26 or later, and the Temporal CLI.
From this repository's root, build Genesys and start the included Go example:

```bash
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
(cd examples/native-workers && go mod download)
node packages/genesys/dist/cli.js dev examples/native-workers
```

This generates registration in an isolated build, compiles the native Worker, and starts it with a
managed Temporal development server. Source changes trigger replacement builds. Previous Workers
remain until native retirement conditions permit shutdown; see [development replacement](docs/builds/development-replacement.md).
Press Ctrl+C to stop the session.

To inspect or build a project without starting a development session, pass its path:

```bash
node packages/genesys/dist/cli.js inspect examples/native-workers
node packages/genesys/dist/cli.js build examples/native-workers
```

Inspection writes a source inventory to `.gsys/discovery`. Builds generate registration and run
native build tools in an isolated version under `.gsys/compile`. The last successful build remains
selected if a later build fails. See [versioned builds](docs/builds/versioned-builds.md).

> [!NOTE]
> The `@genesys/cli` package provides the `gsys` executable and includes its documentation in
> `dist/docs`, so coding agents can read it locally from `node_modules/@genesys/cli/dist/docs`.

### A minimal example

The [Go example](examples/native-workers) includes a Workflow, an Activity, and a Worker.
Its Activity at `temporal/activities/greeting.go` returns a greeting:

```go
package activities

import "context"

func Greet(_ context.Context, name string) (string, error) {
	return "Hello, " + name + "!", nil
}
```

The Workflow at `temporal/workflows/greeting.go` calls it through the native Temporal SDK:

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

The [Worker program](examples/native-workers/temporal/workers/greeting/main.go) imports the generated
`example.com/native-workers/temporal/gsysregistration` package. After it connects to Temporal,
it creates a native Worker and registers the discovered definitions:

```go
w := worker.New(c, "greetings", worker.Options{
	WorkerStopTimeout: 30 * time.Second,
})
gsysregistration.Register(w)
```

Genesys creates that registration package during the build. Adding a Workflow or Activity function
updates the generated registration. The Worker still chooses its Task Queue and SDK options.

With the development session running, submit a Workflow from another terminal:

```bash
temporal workflow execute --type Greeting --task-queue greetings --input '"Ada"'
```

The expected result is `"Hello, Ada!"`. To use more than one language, see the
[Go and Python example](examples/mixed-workers/README.md).

### Add containers

From the repository root, build and start the example with Docker Compose:

```bash
docker compose -f examples/native-workers/compose.yaml build
docker compose -f examples/native-workers/compose.yaml up
```

Stop any local development session first to free the Temporal ports. The image contains a published
Genesys build and starts the native Worker directly. Node.js and Genesys are not required in the
runtime image. This Compose setup is a development example. See the [deployment guide](docs/deployment.md)
for direct process startup, build reuse, and shutdown commands.

## Community

Discuss questions, ideas, and examples with the repository maintainers. The
[glossary](GLOSSARY.md) defines project terms, and [architecture decisions](docs/adr/)
record the project's design choices.

## Contributing

Use Node.js 24 or later and pnpm 12.17.0. From the repository root, install dependencies,
build the CLI, and check types and formatting:

```bash
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
pnpm --filter @genesys/cli typecheck
pnpm fmt:check
```

Install the native toolchains required by the SDKs you change. Read [AGENTS.md](AGENTS.md)
for repository instructions, the [issue tracker guide](docs/agents/issue-tracker.md) for local
issues and specs, and the [end-to-end guide](e2e/README.md) for integration checks.

## Security

Please report security vulnerabilities privately to the repository maintainers. Do not put
vulnerability details or credentials in public issues or pull requests.
