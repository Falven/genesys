# Genesys CLI

`gsys inspect [project-directory]` inventories source without importing application
code, running native package commands, or evaluating build scripts. Node.js 24 or
later is required. Build this package with `pnpm --filter @genesys/cli build`.
The npm package installs the `gsys` executable.

Inspection prints a JSON manifest and writes `.gsys/discovery/manifest.json` and
`diagnostics.json`. Errors produce exit status 1. Help and version flags are available.
`gsys build [project-directory]` generates registration and runs native builds in
a stable, isolated version. `.gsys/compile/manifest.json` selects the last successful
build; failures preserve that selection. Native tooling may execute authored build
code. See [versioned builds](dist/docs/builds/versioned-builds.md) for publication,
provenance, and retention details.

`gsys dev [project-directory]` starts managed Temporal and all discovered Worker
programs. Repeated `--worker <name>` options select a subset without prompting.
Unknown names and startup options for unselected Workers are errors.
Use `--worker-arg=<name>:<argument>` for each Worker argument; only the first colon
separates the name, so empty arguments, further colons, Unicode, and spaces are
preserved. Quote values as required by your invoking shell. Genesys launches
executables directly and does not evaluate arguments through a shell.
`--worker-exec=<name>:<executable>` replaces the complete native startup command
with that executable and only the supplied Worker arguments. Without an executable
override, supplied arguments follow the native startup arguments.

Arguments after `--` go unchanged to `temporal server start-dev`, for example
`gsys dev ./app --worker billing -- --db-filename ./temporal.db`.
Relative server paths use the invocation directory. Worker commands use their
native package directory in the isolated build. Forwarded paths and Worker
connection settings are not rewritten; each native program validates its flags.

A later `gsys dev` invocation checks `.gsys/dev/supervisor.json` before analysis,
builds, watching, or process startup. A responding local supervisor supplies its
current status and live plain logs. All supplied startup options are rejected on
reuse, even when they match the running session. Interrupting a secondary invocation
only disconnects it; the original process still owns shutdown.

The endpoint record contains only the last ready loopback URL and remains after
shutdown. It is advisory: an absent or unresponsive endpoint permits new startup,
and concurrent starts can produce multiple supervisors. Endpoint readiness means
that status is available, not that Workers are ready. Logs are not stored or replayed.
Secondary output truncates large events near 64 KiB and disconnects clients whose
pending output exceeds 256 KiB; at most 16 log clients can connect. Invalid records
are ignored with a diagnostic; filesystem read errors stop the invocation.

Directories named `temporal` identify discovery roots, at any package depth.
Recursive directories named `workflows`, `activities`, `nexus`, and
`workers/<name>` identify source roles. Named Worker directories can also be outside
`temporal`, within their native package layout. Entries are files, not definitions.
Native filenames and package context classify Go, Java (including Kotlin), .NET,
PHP, Python, Ruby, Rust, and TypeScript (including JavaScript) source. The nearest
ancestor manifest for that language supplies package context. This does not prove
that native build rules include a file or that its contents implement a Temporal
definition. SDK analysis must resolve those facts and custom source layouts; file
classification does not claim support for each language variant's native definitions.

Inventory excludes hidden directories, conventional dependency and generated
directories, native test directories and filename patterns, and TypeScript declaration
files. Native .NET `bin`/`obj` outputs are excluded only beneath .NET package context;
`build` is excluded beneath Java, Python, or TypeScript package context. Ruby `bin`
source is retained. A `lib` directory excludes entries but its source remains available to SDK
analysis. Symbolic links are skipped with a diagnostic. An unresolved package
context is an error; multiple .NET project files remain explicitly ambiguous.
Inspection does not set Task Queues, Worker placement, or execution order.
Python `workers/__init__.py` is package initialization, not an unnamed Worker.
See [mixed-language projects](dist/docs/mixed-language-projects.md) for package
boundaries, generated construction inputs, and versioned startup plans.

## Internal SDK contract

`src/contracts.ts` defines the internal boundary; this is not a public plugin API.
Each `src/sdk/<language>.ts` exports a named `<language>Adapter` that implements
`NativeAdapter`. Language identifiers are `go`, `java`, `dotnet`, `php`, `python`,
`ruby`, `rust`, and `typescript`.

`analyze` receives source entries, package context, and static text for all supported
source and package files in the project. It returns definitions, diagnostics, and
native Worker program plans. Neither `analyze` nor `emit` may execute authored code.
Source record paths are slash-separated relative paths; `projectRoot` is absolute.
Definition identities and native scopes must remain unresolved when static evidence
is insufficient. Worker commands are internal execution plans and do not belong in
the discovery manifest. Readiness metadata must describe native evidence or declare
that checks are unavailable; process creation never establishes readiness.

`emit` receives that analysis and returns native code and diagnostics. Artifact paths
are relative to an isolated build's project root. They may be outside `.gsys` where
native import rules require that placement. The build publisher must validate output
paths, reject authored-file collisions, and record every output before publication.
An adapter can emit additional native source or metadata assets. Generated native
functions can accept existing native objects or factories where construction is
required; `Definition.construction` records that requirement. Do not add a container,
application configuration format, required authored registration list, or runtime wrapper.

Manifests use schema version 1 and contain package context, independent entries, and
definition records. Source inventory reports an empty definition list and the explicit
`source-inventory` analysis level. No timestamp or absolute project path is persisted,
so the same inventory has stable output across project locations.

## Installation and platform evidence

Install with `npm install --global @genesys/cli`. The package includes executable
JavaScript, native analyzer sources, full documentation under `dist/docs`, and
Windows x64/arm64 process helpers. It has no install-time compilation step.
Install the native toolchain and dependencies for each application language, plus
the Temporal CLI for `gsys dev`; Node.js does not replace those runtimes.

See the [SDK matrix](dist/docs/sdk-support.md) for all eight exact checked SDK
versions, registration forms, required tools, and known feature limits. See
[platform support](dist/docs/platforms.md) for process ownership, argument handling,
Windows requirements, snapshot links, and verification gaps. The bundled helpers
use Windows 10/Server 2016 Job Objects and private consoles. Their cross-builds and
PE headers were checked; Windows execution and SDK shutdown behavior remain
unverified. Native Ruby SDK 1.11.0 supports macOS/Linux, including WSL, but does not
support MinGW Windows.

During replacement, automatic retirement is limited to the
[checked Go subset](dist/docs/sdk/go.md#bounded-retirement-coverage): SDK 1.51.0,
POSIX, `CGO_ENABLED=0`, unchanged direct launch and complete paired native
unversioned observations. All other programs remain until session shutdown,
including versioned Workers. Heartbeat snapshots alone do not establish complete
program coverage. Live retirement was not exercised during validation.
Interrupting the owner requests Worker shutdown, waits without a Genesys deadline,
and then stops managed Temporal. A second interrupt forces only owned processes.
See [development replacement](dist/docs/builds/development-replacement.md) for
readiness and retirement details.
