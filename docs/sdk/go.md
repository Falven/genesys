# Go

The Go adapter loads the native module with `golang.org/x/tools/go/packages` and reads compiler syntax and type information. It does not run the application, `init`, factories, `go generate`, or custom package drivers. The bundled analyzer needs Go 1.26 or newer. Native module dependencies must be installed. Package loading uses `-mod=readonly`; module, workspace, build tags, GOOS and GOARCH remain native inputs. Custom `GOFLAGS=-toolexec` is rejected during inspection.

Source files in the discovery roles can contain several definitions. Go package inclusion selects platform-specific files. The adapter recognizes typed Workflow functions, Activity functions and receiver methods, callable aliases with a known native function, native Nexus service variables, and factories returning a native Nexus service. Function aliases preserve the referenced function's native name. The resolved SDK `workflow.Context` type determines Workflow recognition, including type aliases. Resolved native Query/Update handler and validator references, including callable aliases, are excluded from automatic registration. Ambiguous references receive source-linked diagnostics. Explicit native registrations remain intact. Signals, Queries and Updates remain inside the authored Workflow and are not separate registrations. Nexus operation handlers remain attached to their authored service.

Generated `zz_genesys_registration.go` files sit beside the native source package. Their marker establishes generated ownership. They are excluded from future discovery entries but participate in native Go builds. Output names and contents are deterministic for equivalent selected source and package inputs. The compile manifest records these locations outside `.gsys`.

Free functions and package service variables use `RegisterGenesys`. Each receiver type gets `RegisterGenesys<Type>` so two receiver groups can use separate Worker scopes. Each Nexus factory gets `RegisterGenesys<Factory>` and accepts the service already constructed by the application. These are ordinary Go functions using `worker.Registry`; there is no new container, execution interface, or configuration file.

Each discovery root also receives a generated `gsysregistration` package. Its `Register` function imports and invokes all discovered Go package helpers. The authored Worker imports this aggregate once:

```go
w := worker.New(c, "orders", worker.Options{})
gsysregistration.Register(w, existingOrders)
```

The generated signature documents each native receiver or Nexus service argument. Adding a function, receiver method, or source package updates the aggregate without another authored registration list. Adding a receiver type requires the application to supply its existing instance. Genesys does not construct it or invent factory arguments. Package-local definitions remain package-local because generated helpers are in the same package.

Applications that need different native scopes can call package-local `RegisterGenesys`, `RegisterGenesys<Type>`, or `RegisterGenesys<Factory>` functions on their existing registries. A private receiver type, a Go `main` package, or a nested `internal` import boundary can prevent aggregate registration; inspection reports that limit and preserves package-local native assembly. Unexported Activity methods are excluded from automatic struct-method recognition, matching native grouped registration. Explicit native assembly can still register a bound private method from its own package.

Native `RegisterWorkflow`, `RegisterActivity`, their `WithOptions` forms, and `RegisterNexusService` remain available. Inspection records directly resolved calls, grouped Activity prefix overrides, compile-time string names and receiver scopes separately from generated defaults. A native override in one Worker is never applied to unrelated Workers. Do not register the same definition twice in one scope through both generated and explicit registration. Direct generated calls through a package import also record their registry scope. Repeated known names produce a diagnostic; control flow and native disable-check options prevent an unconditional runtime collision claim. Dynamic options, closures, generic callable instantiations, runtime service names, indirect registry aliases and external or computed registrations retain explicit native assembly and source-linked diagnostics. This is a static-analysis limit, not a Go SDK feature limit.

For `gsys dev`, a `main` function in a named Worker directory supplies a native
`go build -o ... ./package` command and the resulting executable. The native
module directory is the working directory. A named Worker with no conventional
main or several candidate main packages needs `--worker-exec`. Analysis reports
candidate packages when several mains are available. Duplicate selector names
across distinct Worker directories fail analysis. Native package errors fail
inspection except when generation can replace missing or stale registration.
Native compilation checks generated calls, signatures, and dependencies.

Readiness is unavailable at whole-program scope when the full set of Worker instances cannot be proved. An attributed native heartbeat and successful polling can establish readiness for an observed Worker. Process creation, `Start`, `Run` and startup logs are insufficient. Native version retirement remains separate.

## Build and start a native executable

`gsys build` writes registration into the versioned source snapshot, then runs
`go build -o <executable> ./<package>` for each selected main package under a named
Worker directory. Each main package produces a separate executable. The Go linker
includes the registration the program imports and files it embeds with `go:embed`.
A Worker directory with Go source selected by the target needs a main package to
produce an executable. Go source excluded by the target or build tags can be
absent from the selected build.

Go applies its module, workspace, build tag, target, cgo, and linker settings.
The build record lists the executable path relative to the snapshot and the
`GOOS` and `GOARCH` target. Use `go version -m <executable>` to read available
module and build settings from the binary. Native static analysis requires
`GOFLAGS` without `-toolexec`. For a target that uses cgo, supply the target C
toolchain at build time and any linked shared libraries at runtime. Other native linker settings
can also introduce runtime library requirements. The program needs a compatible
OS and CPU, files it opens at runtime, and its application settings. Those files
may need to stay at paths expected by the program or its recorded working directory.

From the repository root, build and start the bundled Go example against an
available Temporal Service. This example uses `jq` to read the recorded command.

```sh
CGO_ENABLED=0 gsys build examples/native-workers
manifest=$(jq -er '.manifestPath' examples/native-workers/.gsys/compile/manifest.json)
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
leave coverage unknown. The existing `examples/native-workers` program satisfies
this subset when built with `CGO_ENABLED=0`; broader native SDK programs remain
supported for compilation and startup without automatic retirement.

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
Versioned Workers remain retained: Drained status and closed-only reachability
cannot remove pinned-override and closed-Workflow Query needs. Builds stay
referenced until owned process-group completion is confirmed. Registration,
payload and replay compatibility remain application responsibilities.

## Version and validation evidence

On 2026-11-16, `go list -m -json go.temporal.io/sdk@latest` resolved **v1.51.0**, released 2026-11-10. Inspected registration APIs and native name handling in [worker/worker.go](https://github.com/temporalio/sdk-go/blob/v1.51.0/worker/worker.go) and [internal/internal_worker.go](https://github.com/temporalio/sdk-go/blob/v1.51.0/internal/internal_worker.go). Nexus service support uses [nexus-rpc/sdk-go v0.7.0](https://github.com/nexus-rpc/sdk-go/tree/v0.7.0), selected by the SDK. The analysis helper pins `golang.org/x/tools v0.52.0` and its module checksums.

Validation used Go 1.27.4 on macOS arm64: helper `go build`, generated native Worker `go build` with two Workflows, grouped Activity methods and a Nexus service, CLI TypeScript build/typecheck, and formatting. The Worker program was compiled but not started. No tests, test harnesses, assertions, Temporal executions, cross-platform runtime checks, or older SDK compatibility checks were run.

Bounded coverage validation used the existing native example with `CGO_ENABLED=0`
on macOS arm64/Go 1.27.4. The native build emitted `go.coverage-established` with
source/context and binary digests, queue `greetings`, and workflow/activity task
types. Source review covered the retained-unknown paths and runtime evidence gates.
No Worker was started; live readiness, replacement and shutdown remain unverified.
