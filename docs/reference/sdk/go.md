---
title: "Go SDK Reference"
description: "Discover native Go definitions, register them in a Worker, and build an executable."
---

Genesys reads Go package syntax and type information. Install Go 1.26 or later and make your
module dependencies available before inspection. Package loading uses `-mod=readonly` and
respects native modules, workspaces, build tags, `GOOS`, and `GOARCH`. Remove `-toolexec` from
`GOFLAGS` for static analysis. Inspection skips application code, `init`, factories,
`go generate`, and custom package drivers.

## Supported source forms

| Definition            | Supported Go forms                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Workflow              | Typed functions whose context resolves to `workflow.Context`, including context type aliases |
| Activity              | Functions and exported receiver methods                                                      |
| Nexus service handler | Native service variables and factories that return a native service                          |

A discovery entry can contain several definitions. Native build settings select which files
participate. When a callable alias resolves to a function, it keeps that function's native name.
Signals, Queries, and Updates stay in the Workflow. Genesys excludes resolved Query and Update
handlers and validators, including callable aliases, from Activity registration. Nexus operation
handlers stay with their authored service. Ambiguous references produce source-linked diagnostics.

## Register definitions

Genesys writes `zz_genesys_registration.go` beside each native source package in the build
snapshot and records those paths in the compile manifest. The files participate in native Go
builds. A generated marker excludes them from later discovery. Equivalent selected source and
package inputs produce the same names and contents.

| Helper                     | Native definitions it registers                          |
| -------------------------- | -------------------------------------------------------- |
| `RegisterGenesys`          | Free functions and package service variables             |
| `RegisterGenesys<Type>`    | Exported Activity methods on one receiver type           |
| `RegisterGenesys<Factory>` | An existing Nexus service constructed by the application |

The helpers accept a native `worker.Registry`. Each discovery root gets a `gsysregistration`
package whose `Register` function calls its package helpers. Import it in the Worker and pass
the receiver or service instances listed in its generated signature.

```go
w := worker.New(c, "orders", worker.Options{})
gsysregistration.Register(w, existingOrders)
```

Adding a function, receiver method, or package updates the aggregate. Supply an instance
when you add a new receiver type. Package-local helpers preserve Go visibility and let you
register separate groups on different Workers. If a private receiver type, a `main` package,
or a nested `internal` boundary prevents aggregate registration, use package-local native
assembly. To register an unexported Activity method, explicitly register the bound method from
its package.

## Use explicit native registration

You can also use the native `RegisterWorkflow` and `RegisterActivity` methods and their
`WithOptions` forms, or `RegisterNexusService`. Inspection records directly resolved calls,
grouped Activity prefix overrides, compile-time string names, and receiver scopes. It also
records registry scopes for direct calls through a generated package import. Overrides apply
only to their resolved scopes. Register a definition once per scope. Repeated known names
produce a diagnostic. Control flow and native disable-check options can affect runtime behavior.

Dynamic options, closures, generic callable instantiations, runtime service names, indirect
registry aliases, and external or computed registrations can exceed static analysis. Use
explicit native assembly for these forms.

## Select a development Worker

For `gsys dev`, a `main` function in a named Worker directory supplies a native
`go build -o ... ./package` command and the resulting executable. The native module directory
is the working directory. If the named Worker has zero or multiple candidate main packages,
use `--worker-exec`. Inspection lists ambiguous candidates and rejects duplicate names across
distinct Worker directories. Native package errors fail inspection except when generation can
replace missing or stale registration. Compilation checks generated calls, signatures, and
dependencies.

An attributed heartbeat and successful polling can establish readiness for an observed Worker.
Whole-program readiness requires coverage of all Worker instances. Process creation, a call to
`Start` or `Run`, and startup logs cannot supply that evidence. Retirement is a separate decision.

## Build and start a native executable

`gsys build` writes registration into the versioned source snapshot, then runs
`go build -o <executable> ./<package>` for each selected main package under a named
Worker directory. Each main package produces a separate executable. The Go linker
includes the registration the program imports and files it embeds with `go:embed`.
A Worker directory with Go source selected by the target needs a main package to
produce an executable. Go source excluded by the target or build tags can be
absent from the selected build.

Go applies its module, workspace, build tag, target, cgo, and linker settings.
Production Worker builds require an executable build mode (`default`, `exe`, or `pie`).
The build record lists the executable path relative to the snapshot and the
`GOOS` and `GOARCH` target. Use `go version -m <executable>` to read available
module and build settings from the binary. Native static analysis requires
`GOFLAGS` without `-toolexec`. For a target that uses cgo, supply the target C
toolchain at build time and any linked shared libraries at runtime. Other native linker settings
can also introduce runtime library requirements. The program needs a compatible
OS and CPU, files it opens at runtime, and its application settings. Those files
may need to stay at paths expected by the program or its recorded working directory.

Create the `native-workers/` project in [Getting Started](../../getting-started.md). Run these
commands from its parent directory with `jq` and an available Temporal Service.

```sh
CGO_ENABLED=0 gsys build native-workers
manifest=$(jq -er '.manifestPath' native-workers/.gsys/compile/manifest.json)
worker_cwd=$(jq -er '.workers[] | select(.name == "greeting") | .start.cwd' "$manifest")
worker_exe=$(jq -er '.workers[] | select(.name == "greeting") | .start.executable' "$manifest")
(cd "$worker_cwd" && TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=default "$worker_exe")
```

Distribute the executable and the files and libraries your application needs.
Use your deployment tools to start the executable on the recorded target.
A successful build confirms compilation. Runtime compatibility and Temporal
polling require runtime evidence.

## Bounded retirement coverage

A successful build can establish complete Worker coverage for a narrow native
subset. This is optional analysis of the existing Go program; it adds no
application configuration, readiness interface or required startup script.
Unsupported forms still compile and start through the normal native path, with
`go.coverage-unavailable` explaining why prior programs must remain.

The subset requires the released SDK **1.51.0**, a host-target macOS or Linux
build with `CGO_ENABLED=0`, one ordinary `go build -o ... ./package`, and direct
execution of that binary without overrides or forwarded Worker arguments.
Effective native Go settings are read with `go env`; custom flags, experiments,
workspaces, replacements and vendor source make coverage unknown. Native
`go mod verify` checks dependency source, and executable build information must
match the reviewed SDK module checksum, host target and toolchain.

Typed analysis checks all linked application packages, including generated
registration and every Workflow, Activity and other callback body. It accepts
one direct `client.Dial`, one `worker.New` with a constant queue, direct registry
helpers and one `Run(worker.InterruptCh())`. Client options are limited to native
HostPort/Namespace string or environment values. Worker options are limited to
constant WorkerStopTimeout and LocalActivityWorkerOnly values. Calls must resolve
to checked local functions or the bounded native APIs used by this pattern.
Dynamic calls, arbitrary imports, closures, goroutines, package initializers or
mutable globals, methods, generics, native/embedded source and compiler directives
leave coverage unknown. The [Getting Started](../../getting-started.md) program meets this subset when built
with `CGO_ENABLED=0`. Broader native SDK programs can compile and start
without automatic retirement.

The checker runs immediately before and after the exact native compilation, with
no other native build between them. Digests bind the selected source, module files
and effective settings to that compilation; a binary digest binds the result to
launch. This assumes a trusted native toolchain and released libraries, and no
external mutation of the private versioned snapshot or executable. It does not
defend against a hostile host. Launch-affecting Node preload or native loader
environment settings make coverage unknown without changing Worker environment
semantics.

Build evidence alone never authorizes retirement. Both generations must still
have exactly their bound native process, matched by PID and creation time, and
one fresh attributed native Worker heartbeat. Native observations must agree on
SDK identity, namespace, queue, unversioned mode and successful polling for every
expected remote task type. A deployment identity or unexpected active/successful
task type contradicts the proof. All evidence is rechecked after membership
reads; source revision, liveness and shutdown state remain final coordinator
gates. Missing or contradictory evidence retains the predecessor.

Only this unversioned replacement path can request native graceful shutdown.
Genesys retains versioned Workers because pinned overrides and closed-Workflow Queries
can still need them after Drained status or closed-only reachability. Builds stay
referenced until owned process-group completion is confirmed. Registration,
payload and replay compatibility remain application responsibilities.

## Validation

Go SDK 1.51.0 and its Nexus dependency 0.7.0 are the reviewed API versions. The native analyzer
pins `golang.org/x/tools` 0.52.0. See the [Go Worker API](https://github.com/temporalio/sdk-go/blob/v1.51.0/worker/worker.go),
[native name handling](https://github.com/temporalio/sdk-go/blob/v1.51.0/internal/internal_worker.go),
and [Nexus Go SDK](https://github.com/nexus-rpc/sdk-go/tree/v0.7.0).

Go 1.27.4 on macOS arm64 compiled the helper and a generated Worker with two Workflows, grouped
Activity methods, and a Nexus service. A separate build of the native example with
`CGO_ENABLED=0` emitted `go.coverage-established` for Workflow and Activity Tasks on
`greetings`, with source, context, and binary digests. The builds establish compilation and
bounded coverage evidence. Separate [installed-CLI runs](../platforms.md#verified-environments)
exercised Workflow execution on macOS and Linux arm64. Replacement readiness and live
retirement remain unverified.

## Next steps

- Combine a Go Worker with a Python Worker in [Mixed-Language Projects](../../guides/mixed-language-projects.md).
- Use the build record to start the executable in [Native Worker Deployment](../../guides/deployment.md).
