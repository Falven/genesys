# Genesys framework specification

Status: ready-for-agent

## Problem Statement

Temporal developers maintain repetitive registration code alongside native Workflow, Activity, and Nexus implementations.
That assembly becomes harder when a project contains several SDK languages and package layouts.
Separate registration lists can omit new definitions or diverge from the Worker code that a build deploys.

Developers also need a local development loop that builds and supervises native Workers while preserving Temporal behavior.
They need visible errors, stable registration identities, correct argument forwarding, and predictable process ownership.
Replacing a Worker must preserve required versions and running executions.

## Solution

Genesys uses directory conventions to discover native Temporal definitions and generate their registration at build time.
Recognized paths identify source roles. They do not impose a fixed number of definitions per file.
Language-specific tooling preserves native SDK interfaces, package rules, registration forms, and application dependency construction.

Native Worker programs consume generated code packaged with the corresponding versioned build.
Adding a definition in a recognized location updates registration without another authored registration list.
Explicit native registration remains available.

The public executable is `gsys`.
Its development command starts managed Temporal and native Workers, prints errors and logs, watches changes, and supervises replacement.
A responding supervisor can serve another invocation without repeating startup.
Temporal UI remains the interface for Temporal inspection.

## User Stories

1. As a developer, I want directory conventions to identify source roles, so that discovery follows my project structure.
2. As a developer, I want several definitions in one file, so that I can preserve valid native implementations.
3. As a developer, I want automatic registration after adding definitions, so that I do not maintain separate lists.
4. As a developer, I want every supported Temporal SDK language available, so that my application language remains my choice.
5. As a developer, I want mixed-language projects, so that each component can use its appropriate SDK.
6. As a developer, I want language detection from source and package context, so that I do not declare another runtime model.
7. As a developer, I want native source layouts preserved, so that existing package tools continue to work.
8. As a developer, I want recursive discovery, so that I can organize definitions by application responsibility.
9. As a developer, I want helpers and tests excluded from registration, so that colocated code does not become executable definitions accidentally.
10. As a developer, I want native imports and re-exports supported, so that I can reuse existing implementations.
11. As a developer, I want source ownership independent of Worker placement, so that deployment choices remain explicit.
12. As a developer, I want directories to describe source organization, so that they do not start executions or establish execution order.
13. As a developer, I want native Workflow APIs, so that coordination and deterministic execution retain SDK behavior.
14. As a developer, I want native Activity definitions, so that registration preserves the SDK's supported implementation forms.
15. As a developer, I want message handlers owned by their Workflow, so that state and message behavior remain explicit.
16. As a developer, I want native Nexus service registration, so that service contracts and operation handlers retain SDK semantics.
17. As a developer, I want native Worker options, so that I control Task Queues, connections, concurrency, and lifecycle.
18. As a developer, I want native SDK extensions available, so that interceptors, converters, codecs, and observability remain usable.
19. As a developer, I want native dependency construction, so that generated registration can use existing instances, factories, and dependency injection.
20. As a developer, I want explicit native registration available, so that unusual implementations remain possible.
21. As a developer, I want stable native identities, so that moving a source file does not rename a public definition.
22. As a developer, I want conflict checks within native scopes, so that independent Workers can reuse names correctly.
23. As a developer, I want unresolved dynamic values reported, so that inspection does not invent identities or compatibility claims.
24. As a developer, I want compatible payload contracts across languages, so that native Temporal calls can cross SDK boundaries.
25. As a developer, I want existing schema tools usable, so that Genesys does not require another contract language.
26. As a developer, I want static discovery and inspection, so that those operations do not execute application code.
27. As a developer, I want source-linked diagnostics, so that I can locate invalid definitions, conflicts, and ambiguous registration.
28. As a developer, I want inspectable generated registration, so that I can see what native Workers will consume.
29. As a developer, I want reproducible generation, so that equivalent inputs produce equivalent registration artifacts.
30. As a developer, I want authored files preserved, so that generation does not overwrite application code.
31. As a developer, I want SDK-required output locations recorded, so that native import and build rules remain visible.
32. As a developer, I want registration packaged with Worker code, so that deployment uses a complete versioned build.
33. As a developer, I want isolated builds, so that a failed build does not replace the last successful result.
34. As a developer, I want required builds retained, so that running Worker versions keep their matching code and registration.
35. As an operator, I want complete versioned builds, so that future GitOps can deploy them through existing tooling.
36. As a developer, I want native Worker entrypoints discovered, so that I do not write required startup scripts.
37. As a developer, I want ambiguous entrypoints reported, so that startup does not select an unintended program.
38. As a developer, I want all discovered Workers started by default, so that one development command runs the application.
39. As a developer, I want repeated Worker selectors, so that I can run only named Workers.
40. As an automation author, I want identical selection behavior without a terminal, so that commands do not wait for prompts.
41. As a developer, I want unknown Worker names rejected, so that command mistakes remain visible.
42. As a developer, I want explicit executable overrides, so that unusual native startup environments remain usable.
43. As a developer, I want unchanged server arguments, so that Temporal validates and applies its own options.
44. As a developer, I want ordered arguments for each Worker, so that native argument parsing behaves as intended.
45. As a developer, I want argument boundaries preserved without shell evaluation, so that values remain data.
46. As a developer, I want arguments for unselected Workers rejected, so that commands do not silently discard supplied options.
47. As a developer, I want predictable working directories, so that relative arguments resolve correctly.
48. As a developer, I want native Worker connection settings, so that applications retain control of their Temporal connections.
49. As a developer, I want managed Temporal startup for new development sessions, so that the development service starts with the Workers.
50. As a developer, I want Temporal's temporary-state default, so that Genesys does not choose persistent storage for me.
51. As a developer, I want explicit native persistence options, so that I can retain development execution state when needed.
52. As a developer, I want plain process logs and build errors, so that development does not require another UI.
53. As a developer, I want Temporal UI for inspection, so that I use Temporal's existing operational interface.
54. As a developer, I want supervisor reuse, so that a responding session avoids repeated generation, watching, and Worker startup.
55. As a developer, I want an advisory endpoint record, so that an unresponsive endpoint does not prevent a new session.
56. As a developer, I want reused sessions protected from startup reconfiguration, so that another invocation does not alter running processes.
57. As a developer, I want secondary invocations to disconnect independently, so that they do not stop the owner session.
58. As a developer, I want the original process to own session lifetime, so that its exit requests shutdown of owned processes.
59. As a developer, I want replacement builds while current Workers remain active, so that building does not require stopping them first.
60. As a developer, I want native replacement readiness checks, so that process creation alone does not trigger retirement.
61. As a developer, I want failed replacements reported while current Workers remain active, so that development failures preserve the current service.
62. As a developer, I want Temporal kept running during Worker replacement, so that replacing code does not restart the service.
63. As a developer, I want native task routing preserved, so that Genesys does not simulate traffic switching outside Temporal.
64. As a developer, I want pinned Worker versions retained, so that required executions can continue using their versions.
65. As a developer, I want unknown retirement status reported, so that missing evidence does not become permission to stop a Worker.
66. As an operator, I want native tooling to control Worker Versioning routing, so that process supervision does not change deployment policy.
67. As a developer, I want native graceful shutdown settings respected, so that Genesys does not impose another fixed deadline.
68. As a developer, I want a second interrupt to force termination, so that I can end an unresponsive owned session.
69. As a developer, I want Workers stopped before managed Temporal, so that graceful shutdown can still communicate with the service.
70. As an operator, I want unrelated services left running, so that session shutdown affects only owned processes.
71. As a developer, I want Compose and direct processes to consume the same builds, so that local deployment methods share native code.
72. As a developer, I want SDK versions and features reported separately, so that tooling limitations remain distinct from SDK capabilities.
73. As a developer, I want platform checks on macOS, Linux, and Windows, so that the CLI respects each operating system.

## Implementation Decisions

- **Product scope.** Genesys performs discovery, SDK-specific registration generation, validation, artifact inspection, builds, and development supervision. Language support belongs inside tooling. The initial scope does not require a public adapter plugin system.

- **SDK coverage.** All supported Temporal SDK languages remain in scope. The current inventory includes Go, Java, .NET, PHP, Python, Ruby, Rust, and TypeScript. Each Genesys release checks the latest stable release of every official SDK. Release evidence records exact versions and individual features. Older SDK versions enter supported ranges only after checks. SDK feature limits and missing Genesys support remain separate diagnostics.

- **Distribution.** Distribute `gsys` through npm as a Node.js CLI. Support macOS, Linux, and Windows. Node.js runs Genesys tooling and does not constrain application languages or runtimes.

- **Discovery boundary.** Infer implementation language from source files and native package context. Use native manifests and build settings to identify source layouts and package boundaries. Support multiple discovery roots where those layouts require them. Do not execute authored code during discovery or inspection.

- **Directory grammar.** A discovery root has the directory name `temporal` within its native package's source layout. Its recursive role directories use the names `workflows`, `activities`, and `nexus`. Reserve directories named `lib` for helpers and exclude native test files from automatic registration. A directory named `workers` contains named Worker directories. Each language retains its native filename, symbol, import, and package rules.

- **Entry cardinality.** An entry identifies a source role and can expose multiple native definitions. There is no fixed definition count per file. Identify each native definition and generate its appropriate registration automatically. Authors do not split valid implementations or maintain another registration list. Helpers and message handlers do not become separate registrations merely because they share a source file.

- **Native registration shapes.** SDK differences remain inside the generator. Java can register an implementation object whose Activity-interface methods become separate Activities. Python supplies decorated functions or bound methods. TypeScript supplies a mapping from Activity names to functions. All three support multiple Activities in one source file. Other SDKs retain their corresponding native forms and visibility rules.

- **Workflow and Nexus ownership.** Signal, Query, and Update handlers, including Update validators, belong to their native Workflow definition. Workflow code owns its state. Nexus registration uses native services or service handlers, each of which can contain multiple operation handlers. Preserve service names, operation names, contracts, and interfaces. Do not infer service membership from paths.

- **Native capability preservation.** Preserve native Workflows, Activities, Nexus operations, message handlers, Clients, and Worker programs. Preserve child Workflows, local and standalone Activities where supported, timers, cancellation, and Continue-As-New. Native options control Task Queues, connections, concurrency, retries, timeouts, and lifecycle. Interceptors, payload and failure converters, codecs, Sinks, logging, and metrics retain SDK interfaces. Existing native or infrastructure tools manage Namespaces, Schedules, Nexus endpoints, and production deployment.

- **Registration generation.** Generate native imports and SDK-specific registration at build time. Native Workers consume that generated code. Adding definitions at recognized locations updates registration automatically. Explicit native registration remains available. Generated registration is ordinary native code, without another application configuration or execution interface.

- **Dependency construction.** Native Worker programs retain ownership of instances, factories, and dependency injection. Generated code supplies imports and registration wiring. It does not invent constructor arguments or add a container interface. Discovery and inspection do not instantiate application dependencies. Valid native patterns that static tooling cannot resolve remain eligible for explicit native assembly with an accurate diagnostic.

- **Identity and conflicts.** Native definition names, registration overrides, and native defaults determine public identities. Initial source generation can suggest names from paths. Later file moves must not recompute those names. Apply conflict checks within native registration scopes and report relevant sources. Independent scopes can reuse names. Report unresolved dynamic names and scope relationships without claiming complete static knowledge.

- **Cross-language calls.** Use Temporal's native mechanisms and compatible serialized payloads. Reuse existing contracts and schema tools where appropriate. Generated types are optional when existing contracts support them. Genesys does not introduce a mandatory schema system.

- **Manifest contract.** Record each source separately from its definitions. Definition records include source location, native symbol, identity information, and implementation language. Inspection reports unresolved information explicitly. The compile manifest records all output locations, including locations outside the generated root when native SDK rules require them. Manifests describe generated outputs and do not configure application execution.

- **Generated artifact convention.** The generated root has the name `.gsys` and contains generated artifacts only. Its `discovery` child contains `manifest.json` and `diagnostics.json`. Its `compile` child contains `manifest.json`, `metadata.json`, and SDK-specific output. Equivalent source, dependency, tool, and build inputs must produce reproducible registration. Preserve authored files and native import rules.

- **Build publication.** Use an isolated workspace for each build. Publish results only after registration generation and native build steps succeed. A failed build does not replace the last successful result. Package Worker code with its matching generated registration as a complete, versioned build. Preserve required builds and remove only owned generated outputs that no required Worker version uses. Build publication neither establishes readiness nor changes Temporal routing.

- **Build identity.** Build identifiers do not automatically set Temporal Worker deployment names or Build IDs. Native code and deployment tooling retain those decisions. Keep code resolution tied to the corresponding versioned build, including during replacement. Complete packages support future GitOps deployment without implementing a GitOps deployment system in this scope.

- **Worker entrypoints.** Discover native Worker programs through language-specific tooling and package context. Build, start, and supervise those programs without requiring authored startup scripts. A program can create multiple native Worker instances. Use native executable declarations and documented language conventions. Report ambiguous entrypoints and their candidates instead of guessing. Explicit native startup commands remain available for unusual environments.

- **Development startup.** A new `gsys dev` session starts its managed Temporal development server and the selected native Workers. With no Worker selectors, start all discovered Worker programs without prompting. Repeated `--worker <name>` options select only named Workers. Interactive and noninteractive environments use the same selection behavior. Unknown Worker names produce errors. There is no separate all-Workers option or Temporal-service selection mode.

- **Native startup overrides.** The option `--worker-exec=<name>:<executable>` overrides startup for a selected Worker. That executable and the supplied Worker arguments form its complete startup command. Other Workers retain automatic native startup. Unknown or unselected names produce errors. Native build rules remain in the application's package tooling. Overrides do not reconfigure an existing reused session.

- **Argument contract.** Arguments after `--` go unchanged to `temporal server start-dev`. Each repeated `--worker-arg=<name>:<argument>` option forwards one argument to the named Worker. Split the value at its first colon and preserve the remaining argument. Preserve order and boundaries for each destination without shell evaluation. Reject arguments for unknown or unselected Workers. Each destination validates its own flags.

- **Paths and connections.** Relative server arguments resolve from the directory where the user invokes `gsys dev`. Worker commands use the working directory established by native package tooling. Do not rewrite forwarded paths. Show process working directories in inspection output. Worker programs must accept their supplied arguments and configure connections that match the server. Forwarded server arguments do not automatically rewrite Worker connection settings.

- **Persistence.** Preserve Temporal's native development defaults. Execution state is temporary unless the user enables persistence through the forwarded `--db-filename` option. Genesys does not choose a database location automatically.

- **Development output.** Print build errors and process logs. Use Temporal UI for Temporal inspection. Genesys has no terminal UI, separate operational UI, or remote UI connection command. Keep the watcher active after a generation or build failure so a later edit can recover. Do not present a failed build as ready.

- **Supervisor reuse.** Record the last ready supervisor endpoint for each project root. Check whether that endpoint responds before reuse. Reuse a responding supervisor's Workers, logs, and status without repeating local generation, builds, watching, or startup. If the endpoint does not respond, allow a new supervisor to start. The record is advisory and does not guarantee one supervisor per project. Do not add exclusive ownership locks, project-identity handshakes, or protocol-compatibility checks.

- **Reused-session ownership.** A secondary invocation does not own the existing session's lifecycle. Ending it must not stop the owner session. Reject startup arguments that would reconfigure the reused session. The original `gsys dev` process owns the foreground session until it exits.

- **Worker replacement.** Build the replacement while the current Worker remains active. Start the replacement and check native readiness. After readiness succeeds, request graceful shutdown of the previous Worker only when native versioning rules permit removal. If the build or startup fails, retain the current Worker and report the failure. Keep Temporal running throughout replacement.

- **Readiness limits.** Language-specific tooling must establish appropriate native readiness beyond successful process creation. Polling evidence does not prove complete registration or replay compatibility. An unversioned replacement can receive tasks as soon as it polls. Overlapping Workers require compatible registrations and replay-compatible code, or native Worker Versioning. Report unavailable native checks accurately. Unknown readiness or retirement status does not authorize stopping the previous Worker.

- **Version retention and routing.** Retain Worker versions and builds that pinned Workflows still require. Replacement readiness does not authorize their removal. Native application or deployment tooling controls Current and Ramping versions and changes to pinning. Genesys does not move pinned executions or bypass native retirement checks. A replacement can be ready while an earlier version remains necessary or routing changes remain pending.

- **Session shutdown.** Ending the original session requests native Worker shutdown. Wait for the Worker processes to exit under their native SDK settings. Do not impose another fixed deadline over those settings. Stop managed Temporal after its Workers exit. A second interrupt forces termination of owned processes. Services owned elsewhere remain running.

- **Lifecycle distinction.** Explicit session shutdown is separate from automatic Worker-version retirement during replacement. Retention checks must not turn replacement readiness into implicit permission to retire required versions. Supervisor reuse must not give a secondary invocation ownership of shutdown.

- **Deployment methods.** Support Compose, direct local processes, and hybrid development through the same native Worker programs and generated builds. Compose or another process manager can start native programs directly. This does not introduce another service-selection mode into `gsys dev`. Language alone does not determine deployment placement, hardware, queue identity, or concurrency.

- **Inspection and validation modules.** Provide source discovery, native registration generation, native build execution, artifact inspection, and process supervision as tooling responsibilities. Reuse native SDK and package tools within those responsibilities. Keep source analysis separate from operations that execute authored code. Diagnostics must distinguish invalid native definitions, naming conflicts, registration ambiguity, unresolved static information, and unsupported tooling capabilities.

## Testing Decisions

The user excluded tests. Do not add tests, test harnesses, or assertion-based self-checks.
Use available native builds, type checks, formatting, and code review. Record verification limits without claiming runtime compatibility.

## Out of Scope

- Implementing product code or tests as part of this specification publication.
- A new application runtime model, Worker configuration format, execution interface, state-management interface, or registration selector language.
- Required authored startup scripts or separate registration lists.
- Framework-imposed definition counts per file or different file-count rules across SDK languages.
- A mandatory contract schema, mandatory type generator, or public adapter plugin system.
- Automatic execution order, child relationships, Task Queue placement, or Worker placement inferred from definition directories.
- A Genesys terminal UI, operational UI, or remote UI connection command.
- A mode that skips managed Temporal startup for a new development session or selects another Temporal service.
- Exclusive supervisor ownership locks, identity handshakes, protocol-compatibility checks, or a one-supervisor-per-project guarantee.
- Automatic persistent storage selection or another database-location policy.
- Automatic changes to Current or Ramping versions, pinned execution placement, or native retirement protections.
- A guarantee that static inspection resolves all dynamic application behavior or proves replay compatibility.
- Production deployment orchestration, a GitOps controller, or another infrastructure-resource manager.
- Restoration of repository scaffold files that the user intentionally deleted.

## Further Notes

This specification consolidates the final accepted decisions and replaces the interview record.
The local tracker status is `ready-for-agent`.
The user excluded tests before approving the implementation tickets.

The domain glossary remains authoritative for project vocabulary.
The accepted architecture records require native Temporal interfaces and separate replacement readiness from retirement eligibility.
The SDK recognition evidence records inspected native forms and their sources.
That evidence comes from documentation and source review, not executed SDK compatibility tests.

Implementation must establish exact per-SDK source recognition, entrypoint resolution, registration emission, and readiness mechanisms against supported released versions.
It must also document failed-candidate cleanup, dependency invalidation, and generated manifest formats.
These are technical details within the accepted scope, not permission to add another application model or reduce language coverage.
If a native capability cannot be resolved automatically, preserve native assembly and report the tooling limitation accurately.

Supervisor reuse deliberately uses an advisory endpoint record.
Concurrent starts or unresponsive endpoints can lead to more than one supervisor for a project.
Native routing and compatible overlapping Worker behavior remain application responsibilities.

Native retirement checks must account for supported server behavior, status freshness, pinned overrides, and Queries against closed pinned Workflows where applicable.
A successful replacement start or a historical polling observation is insufficient on its own.
Session shutdown remains an explicit end to owned development processes under the agreed native shutdown behavior.
