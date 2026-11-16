---
title: ".NET SDK"
description: "Discover C# definitions, register them with Worker options or native Hosting, and publish a framework-dependent Worker."
---

Use Genesys with a native Temporal C# Worker. Register definitions with `TemporalWorkerOptions`
or with the service builder from `Temporalio.Extensions.Hosting`.

## Prerequisites

- .NET SDK 10 on `PATH` for the isolated Roslyn helper, with restore access for its pinned
  `Temporalio` 1.22.0 metadata dependency.
- The native SDK and packages needed to build your application. The helper uses its own SDK
  references while your native build resolves the application's dependencies.

Inspection reads C# source and pinned reference metadata without loading authored assemblies
or evaluating the application's MSBuild project. A native build can run authored MSBuild hooks.

## Discover definitions

Place C# definitions in the `workflows/`, `activities/`, and `nexus/` directories under a
discovery root. Roslyn resolves native attributes, aliases, source constants, partial types,
nested types, and several definitions in one file.

| Definition            | Source form                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow              | A concrete `[Workflow]` type. Native registration retains run, Signal, Query, Update, and initialization handlers. Interfaces, abstract implementations, and open generic types require a concrete native registration.                                                                                |
| Activity              | An `[Activity]` method, including non-public and eligible inherited methods. Genesys records each method and retains resolved names and `Dynamic = true`. The native Task return-type rule determines when to remove the default `Async` suffix. The SDK validates and invokes the registered methods. |
| Nexus service handler | A type with `[NexusServiceHandler(typeof(IService))]`. The contract's `[NexusService]` supplies the service name. The SDK owns the operation factories and handlers.                                                                                                                                   |

An attributed local function or lambda appears in the inventory. Register its delegate through
the native SDK so it retains its lexical state. A non-dynamic Activity lambda needs an
explicit name. Keep explicit `ActivityDefinition` invokers in authored assembly.

If Genesys resolves the type in an authored `WorkflowDefinition.Create` name and creator
override, it leaves that type out of generated registration. The declaration's name in
inspection is its default. If the type cannot be resolved, Genesys withholds generation to
preserve the authored factory.

Automatic generation requires one ordinary `.csproj` per native package, using
`Microsoft.NET.Sdk`, `Microsoft.NET.Sdk.Worker`, or `Microsoft.NET.Sdk.Web`, with literal
properties and default source inclusion. Conditional or imported settings, inherited
`Directory.Build.props` or `Directory.Build.targets`, custom compile items, project references,
multiple target frameworks, and unresolved attributes can withhold registration and launch.
Use explicit native assembly for those layouts. F# and Visual Basic have source inventory only.

## Register with Worker options

Genesys writes `GenesysRegistration.g.cs` next to the project file in the isolated build, where
the native SDK's default C# compile glob includes it. Import `Genesys.Generated` in your authored
Worker program. The build manifest records the emitted file.

Apply the extensions to the native options for the chosen Task Queue. The following calls use
Activity and Nexus instances already created by the application:

```csharp
using Genesys.Generated;
using Temporalio.Worker;

var options = new TemporalWorkerOptions(taskQueue)
    .AddGenesysWorkflows()
    .AddGenesysStaticActivities()
    .AddGenesysActivities(existingActivityInstance)
    .AddGenesysNexus(existingServiceHandler);
```

`AddGenesysWorkflows` calls the native `AddWorkflow(Type)` for each automatically registered
Workflow. `AddGenesysStaticActivities` registers types whose discovered Activities are all static.
`AddGenesysActivities` uses `AddAllActivities(Type, instance)` and `AddGenesysNexus` uses
`AddNexusService(instance)`. Each instance call uses the exact discovered concrete type. Use
native registration for other runtime subtypes and custom delegates. The application retains
its constructors, factories, instance disposal, and Worker options. Adding an attributed method
to an existing type needs no new registration call.

## Register with native Hosting

When the project references `Temporalio.Extensions.Hosting`, Genesys also emits `AddGenesys()`
on `ITemporalWorkerServiceOptionsBuilder`. After configuring the native Temporal Client and
services, call it on the builder for your Task Queue:

```csharp
host.Services.AddHostedTemporalWorker(taskQueue).AddGenesys();
```

The extension applies `AddWorkflow(Type)`, `ApplyTemporalActivities(Type)`, and
`ApplyNexusService(Type)`. Register services with your usual native dependency injection
settings. The SDK resolves Activity and Nexus dependencies with its own lifetime and scope rules.

Both registration paths apply to the options or builder you pass. Your application chooses
the Worker and Task Queue. If several generated assemblies expose the same extension, call the
`Genesys.Generated.Registration_<package hash>` class explicitly. Genesys reports an error for
duplicate identities in a generated aggregate, including Hosting, the Workflow aggregate, and
the static Activity aggregate. When separate instance calls can use different raw Worker
options, duplicate identities produce a warning.

## Build a Worker

For automatic launch, use an executable C# project with a unique native `Main` or top-level
entrypoint. Several named Worker directories that compile into the same executable leave
automatic launch unresolved. Split them into native projects or use explicit native launch.

Run this command from the application project root:

```sh
gsys build
```

In the versioned snapshot, Genesys adds the generated registration and runs
`dotnet publish <project> -c Release -o .gsys/dotnet/<package hash>`. The native project
compiles the registration into the application assembly and controls the libraries and content
files that publish copies alongside it.

Automatic production publish supports a framework-dependent DLL with its
`<assembly>.runtimeconfig.json`. For a target earlier than .NET 8 with a runtime identifier
(RID), set `PublishSelfContained=false` or `SelfContained=false` to select this mode. Use your
native publish tooling for self-contained, single-file, trimmed, or native AOT output.

## Start the published Worker

Follow `.gsys/compile/manifest.json` to the published version's manifest. The Worker entry
records the output directory, DLL, runtime configuration, and start command. The build
`metadata.json` records the declared target framework and any explicit RID in
`nativeOutput[].target.runtime`. The artifact inventory lists publish output. When enabled,
`<assembly>.deps.json` describes its dependency graph.

From the recorded `start.cwd`, run the manifest's executable and arguments. The framework-dependent
command has this form:

```sh
dotnet ".gsys/dotnet/<package-hash>/<assembly>.dll"
```

Use the paths from your manifest and keep the publish files together. Install the runtime and
shared frameworks specified in the published `.runtimeconfig.json`. Use a host compatible with
the RID and native assets selected by publish. Supply the Temporal connection and other runtime
settings through your application's usual configuration. Preserve any relative paths used from
the working directory. Your application controls deployment and distribution.

Genesys reports .NET readiness as unavailable. Establish it by attributing native heartbeats
to the process generation and observing successful polling by each intended Worker. Dynamic
Worker creation can leave coverage unknown. See the
[readiness and retirement decision](../../adr/0002-separate-readiness-from-retirement.md).

## Verification scope

The inspected API versions are Temporalio and Temporalio.Extensions.Hosting 1.22.0 and NexusRpc
0.5.0. See the released [Activity definition API](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio/Activities/ActivityDefinition.cs),
[Worker options](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio/Worker/TemporalWorkerOptions.cs),
and [Hosting registration](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio.Extensions.Hosting/TemporalWorkerServiceOptionsBuilderExtensions.cs).

The installed CLI's C# fixture used .NET SDK 10.0.404 on macOS arm64 to publish a
framework-dependent `net10.0` application. The recorded command ran raw and Hosting Workers against
Temporal CLI 1.10.0 with Server 1.32.2. The fixture exercised supplied instances, native
dependency injection, Workflow Signals, and Nexus operations. The runtime evidence applies to
those versions and launch paths. It leaves Linux and Windows execution and managed `gsys dev`
startup unverified. Separate native build checks inspected default publish and an explicit
`osx-arm64` RID, both with framework-dependent output.

## Next steps

See [Project Structure](../../concepts/project-structure.md) for entry locations and
[Native Registration](../../concepts/native-registration.md) for combining generated and
explicit registration.
