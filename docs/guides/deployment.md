---
title: "Native Worker Deployment"
description: "Start a published Worker through native tooling, directly or with Docker Compose."
---

Build your Worker application with Genesys, then start the native program through your process
manager or container platform. The application reads Temporal connection settings and other runtime
configuration through its own code. Your deployment tooling supplies those settings and controls
processes, scaling, and release policy.

## Prepare a published build

Use the published manifest to find the Worker command. Preserve its executable, working directory,
argument boundaries, and environment overrides. Pass arguments as separate values to your process
manager. Avoid converting a recorded command into shell text. If the manifest has no startup
command for the Worker, use the application's native launcher from the snapshot.

Choose a compatible operating system and CPU. Supply the language runtime, system libraries,
installed dependencies, and assets required by the program. Keep the versioned snapshot at the
absolute location recorded in the manifest. Python console scripts, for example, can contain the
absolute path to the interpreter and refer to the base Python installation. See
[SDK Support](../reference/sdk/index.md) for language-specific requirements.

## Start the Go Worker directly

Create the `native-workers/` project and install its Go dependencies as shown in
[Getting Started](../getting-started.md#create-the-project). Use that guide's CLI installation and
prerequisites. Open a POSIX shell in the parent of `native-workers/` and make sure `jq` is available.
Build a native Go executable with cgo disabled.

```bash
CGO_ENABLED=0 gsys build native-workers
```

Initial analysis can warn that the `gsysregistration` import is missing. Genesys generates that
package in the snapshot before compiling the Worker. After a successful build, read its immutable
manifest to find the working directory and executable for the `greeting` Worker.

```bash
GSYS_MANIFEST=$(jq -er '.manifestPath' native-workers/.gsys/compile/manifest.json)
GSYS_BUILD_DIR=$(dirname "$GSYS_MANIFEST")
GSYS_CWD=$(jq -er '.workers[] | select(.name == "greeting") | .start.cwd' "$GSYS_MANIFEST")
GSYS_EXECUTABLE=$(jq -er '.workers[] | select(.name == "greeting") | .start.executable' "$GSYS_MANIFEST")
```

In another terminal, start the native Temporal development server.

```bash
temporal server start-dev
```

Return to the terminal with the manifest variables and run the executable. This Worker takes no
command-line arguments.

```bash
(cd "$GSYS_CWD" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default "$GSYS_EXECUTABLE")
```

Open a terminal for the native CLI and execute the Workflow.

```bash
temporal workflow execute --address localhost:7233 --namespace default \
  --type Greeting --task-queue greetings --input '"Ada"'
```

The result is `"Hello, Ada!"`. Press Ctrl+C to stop the Worker, then stop the Temporal server. On
POSIX hosts, the example Worker handles SIGINT and SIGTERM through the Go SDK and allows 30 seconds
for Activity shutdown.

For a production service, configure the connection in native Worker code, including TLS,
credentials, converters, or interceptors as required. The Go example passes `TEMPORAL_ADDRESS`
and `TEMPORAL_NAMESPACE` to `client.Options`; when empty, the SDK defaults to `localhost:7233` and
`default`. See the [Go Worker interface](https://github.com/temporalio/sdk-go/blob/v1.51.0/worker/worker.go)
and [client options](https://github.com/temporalio/sdk-go/blob/v1.51.0/client/client.go).

## Run the Compose development example

These commands require a Genesys source checkout and Docker Compose. From the checkout root,
build and start the development stack. Stop any local server that is using its ports first.

```bash
docker compose -f examples/native-workers/compose.yaml build
docker compose -f examples/native-workers/compose.yaml up
```

The example Dockerfile builds this checkout's CLI and runs `gsys build`. It copies the complete
`.gsys` tree, including the immutable manifest, source snapshot, generated registration, and Worker
executable. The image preserves `/opt/native-workers/.gsys/compile/builds/<id>/project` at its build
path. Two links provide the selected working directory and executable. The container runs the
native executable as a non-root user. The runtime image needs neither Node.js nor Genesys.

Compose starts the Worker after Temporal passes its service health check. The Worker connects to
`temporal:7233`. The host CLI uses `localhost:7233`, and the Temporal UI is at
`http://localhost:8233`. Execute the same Workflow command from the direct example to verify the
Worker. The health check covers the server. Worker readiness and retirement require separate
evidence.

The example uses the Temporal CLI image's `latest` tag, moving toolchain tags, and a development
server without a persistent database. Pin image digests if your deployment requires fixed inputs.

Stop the Worker, then remove the development containers.

```bash
docker compose -f examples/native-workers/compose.yaml stop greeting
docker compose -f examples/native-workers/compose.yaml down
```

Compose allows 45 seconds before forced termination. The example's SDK Activity shutdown interval
is 30 seconds. Set each timeout to match your application's shutdown needs.

## Use Compose for the server only

From the checkout root, start only Temporal.

```bash
docker compose -f examples/native-workers/compose.yaml up -d temporal
```

Start the host Worker with the direct command above. Run it directly when Compose or another
process manager owns the Temporal server. `gsys dev` starts its own managed service and has no
service-selection flag. Stop the host Worker before bringing down the server.

```bash
docker compose -f examples/native-workers/compose.yaml down
```

## Reuse the exact build in Compose

On a Linux host with the same CPU architecture as the container, you can run the exact cgo-disabled
build selected in the direct example. In the shell with the manifest variables, change to the
checkout root. Start the Compose Temporal service as shown above and stop the direct Worker before
starting the container Worker. Mount the immutable version at its original absolute path and use the
host owner's UID and GID to access the private build directory.

```bash
docker compose -f examples/native-workers/compose.yaml build greeting
docker compose -f examples/native-workers/compose.yaml run --rm --no-deps \
  --user "$(stat -c '%u:%g' "$GSYS_BUILD_DIR")" \
  --volume "$GSYS_BUILD_DIR:$GSYS_BUILD_DIR:ro" \
  --workdir "$GSYS_CWD" \
  --entrypoint "$GSYS_EXECUTABLE" greeting
```

That command runs the executable from the mounted build. The Dockerfile builds a Linux executable
from source for ordinary Compose startup. Use that path on macOS or Windows because the host
executable targets a different operating system.

Keep a version while any direct process, container, or retained Worker uses it. See
[Versioned Builds](builds.md#retain-builds-in-use) for retention rules and
[Platform Support](../reference/platforms.md) for the scope of the verified runs.
