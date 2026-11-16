---
title: "SDK Support"
description: "Choose a native Temporal SDK and check its registration forms, tooling, and verification scope."
---

Genesys supports Go, Java, .NET, PHP, Python, Ruby, Rust, and TypeScript. Use the tables below to
choose a reference and check the tools and native registration forms Genesys can use.

## Registration and verification

The versions identify the APIs reviewed in the November 16, 2026 inventory. Native package
tools resolve each application's dependencies.

| SDK                         | Reviewed release                                                            | Workflow registration                                                       | Activity registration                                              | Nexus service registration                                                             | Verification evidence                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Go](go.md)                 | [1.51.0](https://github.com/temporalio/sdk-go/releases/tag/v1.51.0)         | Typed functions, resolved aliases, native names                             | Functions and receiver methods with native instance inputs         | Service variables and factories with nexus-rpc/sdk-go 0.7.0                            | Installed-CLI examples built and ran on macOS and Linux arm64. The mixed Go and Python Workflow ran through `gsys dev` on a macOS arm64 host. |
| [Java](java.md)             | [1.40.0](https://github.com/temporalio/sdk-java/releases/tag/v1.40.0)       | Annotated contracts and implementations with native Workflow initialization | Interface methods and supplied implementation instances            | Native service implementations with Nexus Java 0.6.0-alpha                             | Published Maven and Gradle classpaths ran against local Temporal on macOS arm64.                                                              |
| [.NET](dotnet.md)           | [1.22.0](https://github.com/temporalio/sdk-dotnet/releases/tag/1.22.0)      | C# attributed types and native definitions                                  | Attributed methods, existing instances, native Hosting services    | Handler types and native Hosting services with NexusRpc 0.5.0                          | Framework-dependent publish ran raw and Hosting Workers against local Temporal on macOS arm64 with .NET SDK 10.0.404.                         |
| [PHP](php.md)               | [2.20](https://github.com/temporalio/sdk-php/releases/tag/v2.20)            | Attributes and resolved contract inheritance                                | Interface and class method metadata with a native factory callback | SDK has no public service-handler registration API                                     | Generated registration and factory construction ran on Linux arm64 with PHP 8.4.27 and 8.5.12 and RoadRunner 2025.1.5.                        |
| [Python](python.md)         | [1.36.1](https://github.com/temporalio/sdk-python/releases/tag/1.36.1)      | Decorated classes, aliases, explicit re-exports                             | Decorated functions and bound methods on supplied instances        | Decorated handler instances with nexus-rpc 1.5.0                                       | Analyzer syntax and lint checks passed. The mixed example built and ran both bound Activities through `gsys dev` on macOS arm64.              |
| [Ruby](ruby.md)             | [1.11.0](https://github.com/temporalio/sdk-ruby/releases/tag/v1.11.0)       | Native subclasses and literal identities                                    | Classes, instances, native `Definition::Info` values               | SDK disables service registration                                                      | Native builds passed on macOS arm64 with Ruby 3.4.8. Generated Workflows and Activities ran on Linux arm64 with Ruby 3.4.12.                  |
| [Rust](rust.md)             | [1.2.0](https://github.com/temporalio/sdk-rust/releases/tag/v1.2.0)         | Native SDK macros, direct aliases, existing factories                       | Macro methods and supplied state                                   | SDK supports Workflow Nexus callers and has no public service-handler registration API | Cargo compiled generated registration against SDK and macros 1.2.0 and recorded Apple arm64 executables.                                      |
| [TypeScript](typescript.md) | [1.25.0](https://github.com/temporalio/sdk-typescript/releases/tag/v1.25.0) | Callable exports and re-exports with native Worker scopes                   | Function maps, methods, spreads, known factory result types        | Native service values with nexus-rpc 0.0.3                                             | The published JavaScript Worker ran the `checkout` Workflow against local Temporal on macOS arm64.                                            |

Your application controls its native Client, connection, Task Queues, Worker options, and
dependency construction. Use interceptors, converters, Signals, Queries, Updates, and validators
through the SDK where it provides them.

Generated registration supplies native imports, symbols, objects, or factory inputs. Use those
inputs in your native assembly. Source placement describes discovery. Your Worker program chooses
its Task Queues and registration. Use explicit native assembly for dynamic names, arbitrary
runtime factories, and computed registration membership that analysis cannot resolve.

Runtime results apply to the listed launch paths, SDK versions, and environments. The Rust checks
covered compilation and build output. See [Platform Support](../platforms.md) and each SDK
reference for tools and case details. Windows SDK execution, all-platform ABI
support, replay and payload compatibility, and other SDK versions remain unverified by these
checks.

## Tooling and static analysis limits

| SDK        | Required native tools                                                                        | Important static tooling limits                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go         | Go and the application's module dependencies. The packaged helper pins x/tools 0.52.0.       | Use explicit native assembly for dynamic registration options, closures, generic callable instantiations, and indirect registries.                                                  |
| Java       | JDK 17 or later and application Maven or Gradle tooling                                      | Kotlin files appear in inventory. Java analysis leaves external hierarchies, annotation processors, and arbitrary computed build models unresolved.                                 |
| .NET       | .NET SDK 10 for the packaged Roslyn helper, plus application SDK and runtime                 | Analysis covers C# and inventory includes F# and VB. Use native tooling for custom or imported MSBuild items, project references, multi-targeting, AOT, and self-contained startup. |
| PHP        | PHP 8.2 or later for SDK 2.20, Composer, RoadRunner, and application extensions              | Parser grammar covers PHP through 8.4. Use explicit native assembly for Doctrine or custom metadata, external ancestry, and runtime class aliases.                                  |
| Python     | Python 3.11 or later for AST and TOML inspection, plus native pip, uv, or Poetry build tools | Analysis leaves runtime definitions, wildcard re-exports, custom decorators, dynamic package mappings, and Pipenv environments unresolved.                                          |
| Ruby       | Ruby parser, plus Ruby 3.3 or later and Bundler for SDK 1.11.0                               | Use explicit native assembly for runtime metaprogramming, external inheritance, and ambiguous construction. Native gems target macOS and Linux. Use the Linux gem under WSL.        |
| Rust       | Cargo and Rust. Application SDK builds can require `protoc`.                                 | Use explicit native assembly for conditional or macro-generated definitions, generics, trait implementations, and unresolved module provenance.                                     |
| TypeScript | Installed application dependencies and native compiler and package manager                   | Analysis reports dynamic expressions and unresolved compiler or module types. It reads factory result types statically.                                                             |

Check diagnostics for missing tools, unsupported source forms, and SDK feature limits. Native
tooling can need network access for dependency restores. Inspection reads source statically.
Native builds can run authored build hooks.

## Readiness and retirement

Readiness requires recent native heartbeats tied to the owned host, PID, and process start time,
plus successful polling for known instances. Runtime-created instances can leave whole-program
coverage unknown. Retirement also requires native evidence about versioning, drainage, and pinning.

Genesys can automatically retire previous Workers only for the
[bounded Go subset](go.md#bounded-retirement-coverage). It uses SDK 1.51.0 on POSIX,
`CGO_ENABLED=0`, unchanged direct launch, and complete paired native unversioned observations.
Genesys retains other Workers until session shutdown. Prior checks inspected the build proof.
Live retirement remains unverified. See [Development](../../guides/development.md#understand-readiness-and-retirement)
for replacement behavior.
