# Mixed-language projects

One project can contain native packages for all eight SDK languages. The shared
pipeline inventories each source, assigns its nearest package context for that
language, analyzes owned entries with the native adapter, and emits registration
into one isolated build. It then executes each distinct native build command and
publishes all Worker startup plans together. A failed native build prevents
publication of the candidate; it does not replace the last successful build.

| Language   | Native package context                         | Registration and launch details |
| ---------- | ---------------------------------------------- | ------------------------------- |
| Go         | `go.mod`, native module/workspace rules        | [Go](sdk/go.md)                 |
| Java       | Maven or Gradle package                        | [Java](sdk/java.md)             |
| .NET       | Native project file                            | [.NET](sdk/dotnet.md)           |
| PHP        | Composer package and RoadRunner configuration  | [PHP](sdk/php.md)               |
| Python     | Python package metadata or dependency manifest | [Python](sdk/python.md)         |
| Ruby       | Gemfile or gemspec                             | [Ruby](sdk/ruby.md)             |
| Rust       | Cargo package and targets                      | [Rust](sdk/rust.md)             |
| TypeScript | `package.json`, native compiler settings       | [TypeScript](sdk/typescript.md) |

The same pipeline carries every adapter's definitions, diagnostics, artifacts,
and Worker commands. This does not make every SDK feature or source form
supported: each adapter reports native SDK limits separately from static tooling
limits. Native package tools remain responsible for imports, visibility,
compilation, dependency resolution, and runtime libraries. .NET compile globs,
Cargo modules, and TypeScript imports can legitimately cross a nested directory;
a directory boundary alone must not replace those native inclusion rules.

The inventory retains project source for native import resolution. Each adapter
receives registration entries from only its package. Java's parsed source set and
module detection exclude nested independent Java packages. PHP does not claim a
nested Composer package's RoadRunner configuration. Ruby starts from its own
package files and follows literal `require_relative` references into other
packages without registering foreign entries. Python can resolve imported source
while keeping a nested package's Worker registration scopes separate.

Generated collections retain native visibility and accept application-owned
instances or factories where supported. A constructor parameter is not a second
registration list. Adding methods to one implementation updates generated wiring
while retaining that implementation's native construction. Forms that cannot be
resolved retain explicit native assembly with a diagnostic. No public plugin
interface, required startup script, or new execution configuration is introduced.

Definition identities are native names, not language-prefixed names. Independent
Workers can use equal names. Conflict checks apply to a known native Worker or a
specific generated collection, not all packages in the project. Worker program
names used by CLI selectors must be unique across the project; ambiguity is a
launch-selection error, not a Temporal registration collision. Directories and
source languages do not select Task Queues, execution order, or deployment groups.

Cross-language calls use native Temporal Workflow, Activity, or Nexus mechanisms
where the corresponding SDK supports them. Callers and implementations must agree
on native names and serialized payloads. Use existing converters, codecs, and
schema tools as needed; Genesys requires no schema system and does not claim to
prove payload or replay compatibility statically.

The [Go/Python example](../examples/mixed-workers/README.md) contains a nested
Python package, one Workflow, two bound Activities, one application-owned Activity
instance, and two independently launched Workers on one authored Task Queue. Its
production build produces a Go executable and a Python installation with
generated registration in one versioned workspace. The example shows how to
choose, distribute, and start each output separately.

Inspection identifies language, source, symbol, identity, and package context.
The published compile manifest adds Worker entrypoints, exact commands, working
directories, and generated artifact paths. Startup uses each command's versioned
`cwd`, executable, arguments, and environment, including language-specific code
resolution. Preserve all of these when using another process manager. Source and
registration must remain from the same [versioned build](builds/versioned-builds.md).

The supervisor starts selected native programs independently; it does not merge
their SDK runtime state. Readiness metadata can remain unavailable for any
language when full native Worker coverage is unknown. Process creation, a build,
or successful polling from one instance does not permit retirement of an older
Worker. Native readiness and version retirement remain separate decisions.
