# .NET native registration

The .NET adapter uses Roslyn from .NET SDK 10 to inspect C# without loading application assemblies or evaluating the application's MSBuild project. The isolated helper restores its pinned `Temporalio` 1.22.0 metadata dependency. Native application builds remain a separate operation and can run authored MSBuild hooks.

## Native application use

Generated `GenesysRegistration.g.cs` is placed next to the native project, where the standard SDK compile glob includes it. It is recorded as a generated registration artifact. Import `Genesys.Generated` in the authored Worker program.

For an ordinary `TemporalWorkerOptions` application, use the generated methods while assembling the existing options and application-owned objects:

```csharp
options.AddGenesysWorkflows();
options.AddGenesysStaticActivities();
options.AddGenesysActivities(existingActivityInstance);
options.AddGenesysNexus(existingServiceHandler);
```

Each instance call registers all discovered native definitions on that exact concrete type. The generated code calls `AddAllActivities(Type, instance)` or `AddNexusService(instance)`. It does not create or dispose the instance. Existing constructors, factories, dependency lifetimes, and Worker option settings remain authored. A new attributed method on that type requires no new registration item. Other runtime subtypes and custom delegates retain explicit native registration.

If the project references `Temporalio.Extensions.Hosting`, the adapter also emits `AddGenesys()` on `ITemporalWorkerServiceOptionsBuilder`. Call it on the native builder returned by `AddHostedTemporalWorker`. It uses `AddWorkflow(Type)`, `ApplyTemporalActivities(Type)`, and `ApplyNexusService(Type)`. Application service registrations are retained: the native SDK resolves scoped/transient/singleton services using its own Activity and Nexus scope rules. The generator does not add a dependency on Hosting or invent service constructors. Adding a discovered type needs only the application's normal native construction or service registration, never another per-definition registration list.

The extension applies to the Worker whose authored options/builder receives it. Directory names do not select Task Queues or Workers. Each project has its own generated class named `Registration_<package hash>`. With several generated assemblies in scope, call that class explicitly to select the native package registration.

## Recognition and limits

- Roslyn resolves native attributes, aliases, source constants, partial types, nested types, and multiple definitions in one file. The analyzer uses reference metadata from its pinned released SDK; unresolved application dependencies produce diagnostics instead of executing them.
- Workflows are concrete `[Workflow]` types. Native `AddWorkflow` retains Workflow run/signal/query/update/init handlers and validation. Interfaces, abstract implementations, and open generic types remain contracts or explicit assembly requirements.
- Every `[Activity]` method is recorded separately, including non-public methods and eligible inherited methods. Native name constants and `Dynamic = true` are retained. Default `Async` removal follows the native Task return-type rule. Generated registration delegates method validation and invocation to the SDK.
- Attributed local functions and lambdas are recorded but retain authored delegate registration because they can capture lexical state. Explicit `ActivityDefinition` invokers retain native assembly.
- `[NexusServiceHandler(typeof(IService))]` identifies a handler; `[NexusService]` on the contract supplies the service name. The SDK retains operation factories and handlers. Service and operation code is never invoked during inspection.
- A resolved custom `WorkflowDefinition.Create` type is excluded from automatic registration to preserve its authored name and creator overrides. The declaration's identity is not claimed as the identity of that custom registration. Unresolved custom-factory types withhold emission. Explicit registration scopes are not guessed.
- A collision is fatal only when a generated aggregate would put the definitions into the same native registration. Identical names on instance types that can be passed to different raw Worker options produce a warning.
- Automatic package/launch analysis supports one ordinary C# SDK project with literal properties and default source inclusion. Conditional/imported MSBuild settings, project references, custom compile items, multiple target frameworks, and unresolved attributes are explicit tooling limits; they withhold generated code or launch instead of evaluating hooks. F# and VB remain source inventory and explicit native assembly, not C# registration support.

## Build, launch, and readiness

For an executable C# project, Roslyn resolves the native `Main` or top-level entrypoint. The build plan uses `dotnet publish <project> -c Release -o .gsys/dotnet/<package hash>` from the isolated project root. Startup uses `dotnet .gsys/dotnet/<package hash>/<assembly>.dll` from that same root. This binds the process to its versioned build; it does not run `dotnet run` or rebuild on startup. Ambiguous Worker names, custom executable output, native AOT, and self-contained launch remain unresolved.

Process startup and `ExecuteAsync` are not proof of polling readiness. The Worker plan records readiness as unavailable until supervision can attribute native heartbeat host/PID/start-time evidence to the process generation and establish successful polling for every intended Worker instance. Unknown dynamic instance coverage remains unknown. Native version retirement is a separate decision; startup never authorizes it.

## Inspected versions and verification

Registration APIs were reviewed in released [Temporalio 1.22.0](https://github.com/temporalio/sdk-dotnet/tree/1.22.0), commit `cbc534dae82474cfdab6a9245efbc79deb6dfbf4`, with NexusRpc 0.5.0. In particular, see [Activity reflection](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio/Activities/ActivityDefinition.cs), [Worker options](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio/Worker/TemporalWorkerOptions.cs), and [Hosting registration](https://github.com/temporalio/sdk-dotnet/blob/1.22.0/src/Temporalio.Extensions.Hosting/TemporalWorkerServiceOptionsBuilderExtensions.cs).

The Roslyn helper was built with .NET SDK 10.0.404, and the adapter passed TypeScript type checking. No tests, assertion checks, application Worker execution, or live service checks were run. A native application build must establish compatibility with its own SDK version and source settings.
