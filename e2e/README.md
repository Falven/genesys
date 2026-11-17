# Local CLI integration tests

Install the repository dependencies with `pnpm install --frozen-lockfile`. Use
the Node release in `.nvmrc` and pnpm release in `package.json`. Keep npm and pnpm
on `PATH` so the test can build, pack, and install the CLI. npm and native
dependency downloads may require registry access.

Run the installed Go Workflow and owned-shutdown cases on macOS or Linux.

```sh
pnpm test:e2e 01-installed-go 19-owned-shutdown
```

These cases also require native Go 1.26.0 or newer, the Temporal CLI, and the
platform `ps` utility used by `gsys dev`. See [ticket 22](../.scratch/e2e-suite/issues/22-verify-macos-and-linux-package-and-process-boundaries.md)
for results by OS and architecture. A missing prerequisite fails the selected case.

The runner packs `@gsys/cli` once per case, installs it with npm into a temporary
consumer, and uses that consumer's `gsys` executable in a separate application
directory. Use `pnpm test:e2e` for all local cases. The command runs files in
sequence because the CLI's packaging script writes to the checkout.

For grouped or filtered runs, check the native tools listed in each case's
[ticket record](../.scratch/e2e-suite/issues). See the
[development launch ticket](../.scratch/e2e-suite/issues/13-select-workers-and-preserve-native-launch-arguments.md)
for the BSD or GNU `script` and `ps` tools, and the
[deployment ticket](../.scratch/e2e-suite/issues/21-run-the-same-native-build-directly-and-through-compose.md)
for Docker and Compose. Cases 01, 13, 19, and 21 require macOS or Linux. Other
hosts report these cases as skipped.

The Go case copies the [native Workers example](../examples/native-workers).
It checks these Genesys failure modes.

- Missing packaged Go analyzer or wrong source discovery. Installed `gsys inspect`
  must resolve the native Workflow and Activity identities and find the Worker.
- Broken path handling. Inspect, build, and development startup must use the
  supplied project path, which contains spaces, an apostrophe, and Unicode.
- Mismatched host artifact or missing executable mode. The published manifest
  must select a native executable with the recorded mode. Its Go build settings
  and the published platform metadata must match the test host.
- Incomplete native build or wrong generated registration. Installed `gsys build`
  must publish registration and native output. A native Temporal Client call
  must return the string produced by the Activity that the Workflow invokes.
- Omitted startup or leaked managed processes. Without a terminal or Worker
  selectors, installed `gsys dev` must start Temporal and the Worker. After an
  interrupt, the test checks the supervisor exit, the child PIDs, and the service
  port. The Workflow result establishes that registration served the call.

The owned-shutdown case checks POSIX process group isolation, native graceful
and forced shutdown, and fault propagation when the Worker or Temporal exits.
An unrelated service must stay reachable throughout.

Each case gets its own temporary directories outside the checkout. The Go case uses a loopback port
and a unique Temporal namespace. On failure, Vitest shows tool versions and the
captured ends of subprocess stdout and stderr. The runner attempts bounded
shutdown, including after a test times out, and removes its temporary directories.
For POSIX development sessions, it uses native process identity to verify
group ownership before sending a cleanup signal. It reports live groups whose
ownership it cannot verify.

## Mixed-language project

Run the Go-to-Python call and the independent native Workflow names on macOS
or Linux with Go, Python 3.11 or later with virtual environment support, and the
Temporal CLI.

```sh
pnpm test:e2e 20-mixed-project -t 'Go and Python'
```

Run all eight SDK packages in one build and one Temporal namespace.

```sh
pnpm test:e2e 20-mixed-project -t 'all eight SDKs'
```

The full case also requires JDK 21 and Maven, the .NET 10 SDK, PHP 8.4.1 or
later with cURL and sockets extensions, Composer, RoadRunner with its Temporal
plugin, Ruby 3.3 or later with Bundler, and a Rust toolchain with a native
compiler, `protoc`, and the standard Protobuf imports. Set `PROTOC` and
`PROTOC_INCLUDE` when they require explicit paths. Run the CLI and all native
commands in one environment with these tools on `PATH`. Use the repository Node
version and allow access to the native dependency registries or supply their
caches.

See [ticket 20](../.scratch/e2e-suite/issues/20-execute-a-mixed-language-project-without-package-capture.md)
for the versions and runs. A missing prerequisite fails the full case.

## Windows package and process ownership

On Windows 10 or Windows Server 2016 or later, run the focused Windows cases.

```powershell
pnpm test:e2e 23-windows-boundaries
```

Use x64 or arm64 Node, Go 1.26.0 or later, and the native Temporal CLI. The
host must permit execution of the unsigned packaged helper and nested job
assignment. The cases check the npm-installed command, both helper assets, and
native launch paths and arguments. The packaged helper gives `gsys` a private
test console. Ctrl-C drives the graceful and forced shutdown cases. The cases
also exercise managed Temporal failure and check that a separate service stays
live. Other hosts report these Windows cases as skipped. Missing tools or helper
launch failures on Windows fail the selected cases.
