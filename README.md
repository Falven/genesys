<div align="center">
  <img alt="Genesys logo" src="assets/brand/genesys-logo.svg" height="128">

<a href="package.json"><img alt="Node.js 24 or later" src="https://img.shields.io/badge/Node.js-24%2B-339933.svg?style=for-the-badge&logo=nodedotjs&labelColor=000000"></a>
<a href="docs/reference/sdk/index.md"><img alt="Native Temporal SDKs" src="https://img.shields.io/badge/Temporal-native%20SDKs-000000.svg?style=for-the-badge&labelColor=000000"></a>
<a href="docs/reference/platforms.md"><img alt="Platform support" src="https://img.shields.io/badge/Platform-support-blueviolet.svg?style=for-the-badge&labelColor=000000"></a>

</div>

Genesys uses your project's directory layout to find native Temporal Workflows, Activities, Nexus
service handlers, and Worker programs. It generates native registration code and builds each version
in isolation. During local development, it runs the Workers and a Temporal server. Your application
still controls SDK settings, Task Queues, and the Worker lifecycle.

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

You can place a discovery root at any depth within a package. Genesys has adapters for Go, Java,
.NET, PHP, Python, Ruby, Rust, and TypeScript. Each package uses its own dependencies and build tools.
The [documentation](docs/README.md) covers project layout. Check the
[SDK support matrix](docs/reference/sdk/index.md) for what each adapter supports. The
[mixed-language guide](docs/guides/mixed-language-projects.md) explains how to lay out projects that
use more than one SDK and how registration works across packages.

## Quick start

You need Node.js 24 or later, pnpm 12.17.0, Go 1.26 or later, and the Temporal CLI. Run these commands
from the repository root to build Genesys and start the Go example.

```bash
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
(cd examples/native-workers && go mod download)
node packages/genesys/dist/cli.js dev examples/native-workers
```

The last command generates registration code and compiles the native Worker in an isolated build.
Genesys then starts the Worker and a Temporal development server. When you edit the source, Genesys
builds a replacement. It keeps the previous Worker running unless it can verify that the Worker can
stop safely. See [how source changes replace Workers](docs/guides/development.md#work-with-source-changes).
Press Ctrl+C to stop the session.

Pass the project path to inspect or build it without starting a development session.

```bash
node packages/genesys/dist/cli.js inspect examples/native-workers
node packages/genesys/dist/cli.js build examples/native-workers
```

Genesys writes the source inventory to `.gsys/discovery`. When you build, Genesys generates
registration and runs the native build tools in an isolated version under `.gsys/compile`. If a build
fails, Genesys keeps the last successful build selected. See [versioned builds](docs/guides/builds.md).

To create a project from scratch, follow [Getting Started](docs/getting-started.md).

> [!NOTE]
> The `@genesys/cli` package includes the `gsys` executable and its documentation in `dist/docs`.
> Coding agents can read the docs at `node_modules/@genesys/cli/dist/docs`. Install the
> [Genesys skill](skills/genesys/) to point your agent to the docs for the CLI version it uses.

### A minimal example

In the [Go example](examples/native-workers), the Activity at `temporal/activities/greeting.go`
returns a greeting.

```go
package activities

import "context"

func Greet(_ context.Context, name string) (string, error) {
	return "Hello, " + name + "!", nil
}
```

The Workflow at `temporal/workflows/greeting.go` calls the Activity through the native Temporal SDK.

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

Genesys generates the `example.com/native-workers/temporal/gsysregistration` package during the build.
The [Worker program](examples/native-workers/temporal/workers/greeting/main.go) imports it. After
connecting to Temporal, the program creates a native Worker and registers the definitions Genesys found.

```go
w := worker.New(c, "greetings", worker.Options{
	WorkerStopTimeout: 30 * time.Second,
})
gsysregistration.Register(w)
```

When you add a Workflow or Activity function, Genesys updates the registration on the next build.
The Worker program chooses the Task Queue and SDK options.

Leave the development session running and execute the Workflow from another terminal.

```bash
temporal workflow execute --type Greeting --task-queue greetings --input '"Ada"'
```

The expected result is `"Hello, Ada!"`. To use more than one language, see the
[Go and Python example](examples/mixed-workers/README.md).

### Add containers

Stop any local development session to free the Temporal ports. Then run Docker Compose from the
repository root.

```bash
docker compose -f examples/native-workers/compose.yaml build
docker compose -f examples/native-workers/compose.yaml up
```

This Compose setup is for development. The image contains a published Genesys build and starts the
native Worker directly. The Worker runs without Node.js or Genesys in the runtime image. See the
[deployment guide](docs/guides/deployment.md) for how to start the Worker directly, reuse a build, or
stop the services.

## Community

Share questions, ideas, and examples with the maintainers. The
[glossary](GLOSSARY.md) defines project terms, and [architecture decisions](docs/adr/)
record the project's design choices.

## Contributing

Use Node.js 24 or later and pnpm 12.17.0. Install the native toolchains for the SDKs you change, then
run these commands from the repository root.

```bash
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
pnpm --filter @genesys/cli typecheck
pnpm fmt:check
```

Read [AGENTS.md](AGENTS.md) for repository instructions. The
[issue tracker guide](docs/agents/issue-tracker.md) covers local issues and specs. Use the
[end-to-end guide](e2e/README.md) to run integration checks and the
[SDK adapter maintainer guide](docs/agents/sdk-adapters.md) to change an adapter.
See [CI and Releases](docs/agents/releases.md) for GitHub checks and npm publishing.

## Security

Report security vulnerabilities privately to the repository maintainers. Keep vulnerability
details and credentials out of public issues and pull requests.
