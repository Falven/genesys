# SDK versions and capabilities

The release inventory below was refreshed on **2026-11-16** against the latest
stable release returned by each official SDK repository. The linked SDK pages
record the APIs and source forms inspected. Exact versions are evidence points,
not compatibility ranges. Native package tools resolve each application's version;
Genesys does not replace that resolution or upgrade application dependencies.

| SDK                             | Latest stable release checked                                               | Workflow registration                                                   | Activity registration                                            | Nexus service registration                                                     | Validation evidence                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Go](sdk/go.md)                 | [1.51.0](https://github.com/temporalio/sdk-go/releases/tag/v1.51.0)         | Typed functions, resolved aliases, native names                         | Functions and receiver methods; native instance inputs           | Service variables and factories; nexus-rpc/sdk-go 0.7.0                        | Go 1.27.4 helper and generated native Worker compiled on macOS arm64; Linux arm64 example compiled in ticket 17                                     |
| [Java](sdk/java.md)             | [1.40.0](https://github.com/temporalio/sdk-java/releases/tag/v1.40.0)       | Annotated contracts and implementations; native Workflow initialization | Interface methods and application-owned implementation instances | Native service implementations; Nexus Java 0.6.0-alpha                         | JDK reader and generated application compiled with Temurin 21.0.13+9, Maven 3.9.11 and Gradle 9.2.1 on macOS arm64                                  |
| [.NET](sdk/dotnet.md)           | [1.22.0](https://github.com/temporalio/sdk-dotnet/releases/tag/1.22.0)      | C# attributed types and native definitions                              | Attributed methods, existing instances, native Hosting services  | Handler types and native Hosting services; NexusRpc 0.5.0                      | Roslyn helper built with .NET SDK 10.0.404; no native application runtime check                                                                     |
| [PHP](sdk/php.md)               | [2.20](https://github.com/temporalio/sdk-php/releases/tag/v2.20)            | Attributes and resolved contract inheritance                            | Interface/class method metadata; native factory callback         | No public SDK service-handler registration API                                 | v2.20 API diff reviewed; Composer 2.11.2 installed dependencies on Linux arm64/PHP 8.5.12; generated registration and Workflow passed syntax checks |
| [Python](sdk/python.md)         | [1.36.1](https://github.com/temporalio/sdk-python/releases/tag/1.36.1)      | Decorated classes, aliases and explicit re-exports                      | Decorated functions and bound methods on supplied instances      | Decorated handler instances; nexus-rpc 1.5.0                                   | Python analyzer syntax/lint checks; shared Go/Python example built with native dependencies in ticket 16                                            |
| [Ruby](sdk/ruby.md)             | [1.11.0](https://github.com/temporalio/sdk-ruby/releases/tag/v1.11.0)       | Native subclasses and literal identities                                | Classes, instances and native Definition::Info values            | SDK disables Nexus service registration                                        | Parser syntax checked with Ruby 2.6.10/3.4.12; released Linux arm64 gem installed; no Worker execution                                              |
| [Rust](sdk/rust.md)             | [1.2.0](https://github.com/temporalio/sdk-rust/releases/tag/v1.2.0)         | Native SDK macros, direct aliases, existing factories                   | Macro methods and application-owned state                        | SDK has Workflow Nexus callers, but no public service-handler registration API | Bundled analyzer and emitted registration passed native Cargo compilation against SDK/macros 1.2.0 on macOS arm64                                   |
| [TypeScript](sdk/typescript.md) | [1.25.0](https://github.com/temporalio/sdk-typescript/releases/tag/v1.25.0) | Callable exports and re-exports; native Worker scopes                   | Function maps, methods, spreads and known factory result types   | Native service values; nexus-rpc 0.0.3                                         | Compiler API 6.0.3 analysis and Genesys build/typecheck; no authored Temporal application runtime check                                             |

All eight adapters preserve native Worker options, Clients, connections, queues,
interceptors, converters, and dependency construction. Signal, Query, Update and
validator handlers stay with their native Workflow. Feature availability inside
a Workflow remains an SDK responsibility; the table does not claim that every
SDK has every Temporal operation. PHP, Ruby and Rust Nexus limits concern service
handlers, not an invented substitute API.

Generated collections contain native imports, symbols, objects or factory inputs.
An application consumes them in its native assembly. Source placement does not
assign a Task Queue or Worker. Dynamic names, arbitrary runtime factories and
computed registration membership remain unresolved when static evidence is
insufficient. Explicit native registration remains available.

## Tooling and unsupported forms

| SDK        | Required native tools                                                             | Important static tooling limits                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go         | Go and the application's module dependencies; packaged helper pins x/tools 0.52.0 | Dynamic registration options, closures, generic callable instantiations and indirect registries require native assembly                                               |
| Java       | JDK compiler API and application Maven/Gradle tooling                             | Kotlin inventory does not imply Kotlin registration analysis; external hierarchies, annotation processors and arbitrary computed build models are unresolved          |
| .NET       | .NET SDK 10 for the packaged Roslyn helper; application SDK/runtime               | C# only; F#/VB are inventory. Custom/imported MSBuild items, project references, multi-targeting, AOT and self-contained startup need native assembly                 |
| PHP        | PHP 8.2+ for SDK 2.20, Composer, RoadRunner and application extensions            | Parser grammar through PHP 8.4; Doctrine/custom metadata, external ancestry and runtime class aliases need native assembly                                            |
| Python     | Python 3.11+ for AST/TOML inspection; native pip, uv or Poetry build tools        | Runtime definitions, wildcard re-exports, custom decorators, dynamic package mappings and Pipenv environments are unresolved                                          |
| Ruby       | Ruby parser; Ruby 3.3+ and Bundler for SDK 1.11.0                                 | Runtime metaprogramming, external inheritance and ambiguous construction are unresolved. Native MinGW Windows is unsupported by the SDK; Linux/WSL uses its Linux gem |
| Rust       | Cargo/Rust; application SDK builds can require protoc                             | Conditional/macro-generated definitions, generics, trait implementations and unresolved module provenance remain native assembly                                      |
| TypeScript | Installed application dependencies and native compiler/package manager            | Dynamic expressions and unresolved compiler/module types remain diagnostic; Genesys does not execute factories during analysis                                        |

Missing tools produce tooling diagnostics. A parser or SDK feature limit is not
reported as a missing executable. Dependencies and native analyzers can need
network access during their normal restore/build steps; inspection does not run
authored application code or build hooks.

Readiness requires recent native heartbeats attributed to the owned host, PID and
creation time, plus successful polling for known instances. Runtime-created
instances can leave whole-program coverage unknown. Retirement also needs native
versioning, drainage and pinning evidence. Process creation, a successful build or
an available supervisor endpoint cannot establish either result.

These checks do not establish Windows SDK execution, all-platform ABI support,
live polling, replay compatibility, payload compatibility, or older-version
compatibility. No tests, test harnesses, assertion-based checks, Worker sessions or
Temporal executions were run for this release work. See [platform evidence](platforms.md)
and each SDK page for the scope of earlier native build checks.

Automatic previous-program retirement is limited to the [checked Go subset](sdk/go.md#bounded-retirement-coverage)
on POSIX, with SDK 1.51.0, `CGO_ENABLED=0`, unchanged direct launch and complete
paired native unversioned observations. All other programs remain until session
shutdown. Native heartbeat snapshots alone omit disabled or delayed Workers and
cannot establish complete program coverage. No versioned retirement path is
supported: historical Drained status and closed-only reachability do not remove
pinned-override or closed-Query needs. The positive build proof was inspected;
live retirement was not exercised.
