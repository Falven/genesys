# Native Worker deployment

Compose and direct processes start the native Worker from a published Genesys
build. They use its generated registration and native executable. There is no
Genesys runtime wrapper or deployment service.

The [Go example](../examples/native-workers) contains a `Greeting` Workflow, a
`Greet` Activity, and one native Worker named `greeting`. The Worker imports the
generated `temporal/gsysregistration` package once. It chooses the `greetings` Task
Queue in native code and reads `TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE` into
`client.Options`. Empty values use the SDK defaults (`localhost:7233`, `default`).
Add TLS, credentials, converters, interceptors, and other SDK options to that same
native application code when needed.

## Build and start a local process

Use Node.js 24 or newer, pnpm 12.17.0, Go 1.26 or newer, the Temporal CLI, and `jq`.
The commands below use a POSIX shell from the repository root. They compile this
checkout's real CLI; no published npm package is required.

```sh
pnpm install --frozen-lockfile
pnpm --filter @genesys/cli build
(cd examples/native-workers && go mod download)
CGO_ENABLED=0 node packages/genesys/dist/cli.js build examples/native-workers
```

An installed `gsys build examples/native-workers` is equivalent to the last
command. Generation occurs in the versioned snapshot. The authored example does
not contain generated registration and cannot be built with `go build` alone
before generation. Initial analysis can report the missing generated import;
successful native compilation remains the required build result.

Read the current selector once, then read only that immutable manifest:

```sh
GSYS_MANIFEST=$(jq -er '.manifestPath' examples/native-workers/.gsys/compile/manifest.json)
GSYS_BUILD_DIR=$(dirname "$GSYS_MANIFEST")
GSYS_CWD=$(jq -er '.workers[] | select(.name == "greeting") | .start.cwd' "$GSYS_MANIFEST")
GSYS_EXECUTABLE=$(jq -er '.workers[] | select(.name == "greeting") | .start.executable' "$GSYS_MANIFEST")
```

This example's generated start command has no arguments. For other applications,
also preserve its `start.args` boundaries and any `start.env` values. Do not turn
arguments into shell text or execute them with `eval`.

In another terminal, start the native development server:

```sh
temporal server start-dev
```

Start the selected Worker directly:

```sh
(cd "$GSYS_CWD" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default "$GSYS_EXECUTABLE")
```

To submit a Workflow through the native CLI:

```sh
temporal workflow execute --type Greeting --task-queue greetings --input '"Ada"'
```

Use Ctrl+C to stop the Worker before stopping Temporal. The SDK handles SIGINT and
SIGTERM and has a 30-second Activity shutdown interval in this example.

## Build and start containers

From the repository root:

```sh
docker compose -f examples/native-workers/compose.yaml build
docker compose -f examples/native-workers/compose.yaml up
```

The Dockerfile compiles this checkout's CLI, runs `gsys build` through its CLI
entrypoint, and packages the entire `.gsys` tree. That includes the immutable
manifest, copied native source, generated registration, and compiled Worker.
The image retains `/opt/native-workers/.gsys/compile/builds/<id>/project` at the
same absolute path used during compilation. Two links selected during image
construction supply the native working directory and executable. Startup runs
that executable directly as a non-root user; Node.js and Genesys are not required
in the runtime image.

Compose waits for the Temporal service health check, then starts the Worker with
`TEMPORAL_ADDRESS=temporal:7233`. The host CLI connects through `localhost:7233`.
Temporal UI is available at `http://localhost:8233`. The development server has no
persistent database in this example. Its health check does not establish Worker
readiness or permit retirement of another Worker version.

The example uses the Temporal CLI image's `latest` tag and moving native toolchain
tags. Pin image digests for deployments that require fixed inputs. This Compose
file is a development example, not production orchestration.

Stop the Worker before its server, then remove the development containers:

```sh
docker compose -f examples/native-workers/compose.yaml stop greeting
docker compose -f examples/native-workers/compose.yaml down
```

Compose allows 45 seconds before forced termination; the SDK's configured Activity
shutdown interval is 30 seconds. Review both settings for application shutdown
requirements. A process manager timeout does not establish native retirement
eligibility.

## Hybrid use and exact build reuse

For a containerized server and a host Worker, start only Temporal with Compose,
then use the local build and direct Worker command above:

```sh
docker compose -f examples/native-workers/compose.yaml up -d temporal
```

On a Linux host with the same CPU architecture as the image, the **exact local
build** selected above can also run under Compose. Build the example with
`CGO_ENABLED=0` as shown, prepare the image once, and mount the selected immutable
version at its original absolute path. Run the container as the host build owner's
UID:GID so that the private `0700` version directory remains accessible:

```sh
docker compose -f examples/native-workers/compose.yaml build greeting
docker compose -f examples/native-workers/compose.yaml run --rm --no-deps \
  --user "$(stat -c '%u:%g' "$GSYS_BUILD_DIR")" \
  --volume "$GSYS_BUILD_DIR:$GSYS_BUILD_DIR:ro" \
  --workdir "$GSYS_CWD" \
  --entrypoint "$GSYS_EXECUTABLE" greeting
```

This command uses the same executable and generated source as direct startup;
it does not regenerate registration or read mutable authored code. The image's
own build is unused for this command. Stop the direct Worker first unless both
instances are intentionally compatible consumers of the same Task Queue.

A macOS or Windows native executable cannot run in a Linux container. Use the
Dockerfile to produce the Linux build there. Those builds share source and build
rules, but have different IDs and platform-specific binaries. Other languages
can also require native libraries or installed runtime dependencies. Preserve
their complete build and dependency environment. In particular, Python virtual
environments can contain absolute paths and must not be relocated.

Keep each immutable version while any direct process, container, or retained
Worker version requires it. A new build or a healthy replacement does not permit
removing a previous version. See [versioned builds](builds/versioned-builds.md)
for publication and retention rules.

`gsys dev` owns its managed Temporal service. For a server owned by Compose or
another process manager, start the native Worker directly as above. There is no
`gsys dev` service-selection flag, required `run` script, or additional Worker
configuration format.

The SDK APIs used here are documented in the native
[Go Worker interface](https://github.com/temporalio/sdk-go/blob/v1.51.0/worker/worker.go)
and [client options](https://github.com/temporalio/sdk-go/blob/v1.51.0/client/client.go).
Server flags remain the native
[Temporal CLI options](https://docs.temporal.io/cli/command-reference/server).
