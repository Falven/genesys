# Java

Java analysis uses the JDK compiler's syntax trees. Install JDK 17 or later and set `JAVA_HOME` or put `java` on `PATH`. The application can target a different Java release through its native build tool. A macOS Java launcher without an installed JDK is insufficient.

The reader parses copies of the discovery snapshot with annotation processing disabled. It never attributes or compiles application classes, loads application classes, invokes factories, or evaluates Maven/Gradle during analysis or emission. Native builds are separate and can execute authored build logic.

## Recognition

Source imports, qualified annotation names, source interfaces, superclass chains, nested types, string constants, and string concatenation determine static identities. Each concrete implementation is related to its native contract:

- Workflows use `@WorkflowInterface` and `@WorkflowMethod`. The interface supplies the default Workflow type name. Signals, Queries, Updates, validators, and implementation state remain attached to that Workflow.
- Activities use `@ActivityInterface`, inherited interface methods, optional `@ActivityMethod(name = ...)`, and `namePrefix`. Native defaults capitalize the first character of the method name. The inventory has one definition per Activity method; registration passes each implementation instance once.
- Nexus uses `@ServiceImpl(service = Contract.class)` and the contract's `@Service`. The service default is the interface's simple name. The native SDK discovers and validates operation handlers on the registered instance, including native method extensions. Genesys does not flatten operations into independent services.
- `DynamicWorkflow` and `DynamicActivity` implementations retain dynamic identities.

Annotation constants that cannot be resolved from the source snapshot remain unresolved. External ancestors, generic substitutions that need compiler attribution, Kotlin, dynamically constructed Nexus services, and definitions created by native annotation processors require explicit native assembly. These are analysis limits, not SDK feature limits. The reader does not claim full Java symbol attribution or evaluate dependencies to obtain it. Native compilation and SDK registration remain authoritative for semantic validation.

Multiple definitions per source file are supported. Interface declarations themselves are contracts, not second implementation registrations. Source roles select the primitive to discover. Helpers outside the recognized entries can supply contracts and ancestors but do not become registrations.

## Generated registration

Each discovery root produces `genesys.generated.GenesysRegistration_<root hash>`. The artifact record contains the exact class and path. Its static `register` method receives an existing `io.temporal.worker.Worker` and typed Activity/Nexus implementation instances. All discovered implementations in that root are included automatically. Adding a method to an Activity interface requires no authored registration edit.

The application supplies every Activity and Nexus instance, including types with public no-argument constructors. No convenience overload constructs those dependencies.

Workflow registration uses `registerWorkflowImplementationTypes`. A public no-argument constructor or public `@WorkflowInit` constructor must be visible in the source. The native SDK supplies Workflow input to `@WorkflowInit` and retains Workflow instantiation semantics. Genesys does not use `registerWorkflowImplementationFactory` for production dependency injection: the inspected SDK marks those APIs for testing and mocking.

The aggregate creates one native registration scope only when authored code calls it. Inspection does not infer a Task Queue or associate a definition with a Worker from its directory. Duplicate identities, including duplicate dynamic handlers, produce a warning and omit the ambiguous aggregate. Independent Workers may reuse identities; use explicit native assembly when definitions with the same identity belong to separate scopes.

Generated code does not change visibility. Private, package-private, non-static member, unnamed-package, or unresolved-construction types receive a diagnostic and retain native assembly in their authored scope. Generated source goes into the source root inferred from package declarations and source paths. If that root is ambiguous, the artifact goes into `.gsys/generated/java` and a diagnostic requires native source-set inclusion. All writes belong to the isolated build snapshot; authored source is not rewritten.

## Build and launch

Worker entries expose `public static void main(String[])`, including nested classes with native binary names. Several candidate main classes in one named Worker directory produce one unresolved launch plan and a candidate diagnostic; an executable override can select native startup. Distinct Worker directories that share a selector name remain an error. When no conventional main is found, the named Worker and native package cwd remain in the plan for an executable override. Native source errors still fail compilation. Other native launcher forms remain available through the executable override.

Run `gsys build /path/to/java-project` to generate registration and prepare the native classpath. The native build compiles registration in the application source set along with the authored code. Maven and Gradle build the main source set without running tests.

For Maven, the adapter prefers the nearest wrapper within the project, then `mvn`. The build runs `compile` and copies dependencies for the runtime classpath with `maven-dependency-plugin:3.9.0:copy-dependencies`. The classpath contains the native `outputDirectory` for classes and resources, plus the JARs in `target/genesys-dependencies`. The XML reader resolves local POM properties for the output path. Parent models, profiles, non-JAR modules, unresolved or external output paths, module-path applications, and reactor-only dependencies require native launcher assembly. Static inspection reads the local POM without running Maven.

For Gradle, the adapter prefers the nearest wrapper within the project, then `gradle`. The generated init script selects the Gradle project whose directory matches the package. Its `gsysPrepareWorker` task depends on `classes` and copies the evaluated Java `main.runtimeClasspath` to `build/genesys-worker`. The classpath contains that directory for classes and resources, plus its JARs. A conflict between files with the same relative path fails the copy. Source sets and layouts that need a different classpath assembly require native launcher assembly.

For a resolved classpath launch, the build manifest records the Java executable, classpath arguments, and working directory. The production metadata records the classpath output directory and compiled main class paths in `nativeOutput`. The manifest's `artifacts` records include copied JARs and resources from the build. Use a JVM compatible with the application's compiled bytecode and dependencies. Runtime dependencies supplied by the application environment must be available at startup.

The following example uses a Maven project with `target/worker-classes` as its `outputDirectory`. Run the `java` command from the package directory in the retained build, using the `cwd` in the recorded start command. Keep the output directories and their relative paths intact.

```sh
gsys build /path/to/java-project
cd "/path/from/the/recorded/start/cwd"
java -cp 'target/worker-classes:target/genesys-dependencies/*' 'example.temporal.workers.nativeworker.Main$Launcher'
```

For the same main class in a Gradle build, use the Gradle output on the classpath.

```sh
java -cp 'build/genesys-worker:build/genesys-worker/*' 'example.temporal.workers.nativeworker.Main$Launcher'
```

The examples use the POSIX classpath separator. Use the executable and argument boundaries in the recorded command on your platform. Supply runtime settings through your native startup tools. Any additional archive or distribution layout belongs to the native project.

Native wrapper scripts require the platform's normal executable support. Windows batch-wrapper execution and platform-specific classpath behavior were not verified here.

`WorkerFactory.start()` and `isStarted()` do not establish readiness. The adapter reports readiness as unavailable until the supervisor can attribute fresh native heartbeats and successful polling to the actual process generation. Java heartbeats require compatible SDK/server versions and enabled native settings. Dynamic Worker creation can leave whole-program coverage unknown. Retirement remains a separate native decision; see [the readiness and retirement ADR](../adr/0002-separate-readiness-from-retirement.md).

## Version and verification evidence

Inspected release: Temporal Java SDK **1.40.0**, with Nexus Java SDK **0.6.0-alpha** as declared by that released Temporal artifact. This is source/API evidence, not a verified compatibility range for arbitrary SDK versions.

- [Released Worker registration APIs](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/worker/Worker.java)
- [Activity interface inheritance](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/common/metadata/POJOActivityInterfaceMetadata.java)
- [Workflow interface metadata](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/common/metadata/POJOWorkflowInterfaceMetadata.java)
- [Released Temporal artifact dependencies](https://repo.maven.apache.org/maven2/io/temporal/temporal-sdk/1.40.0/temporal-sdk-1.40.0.pom)
- [Released Nexus sources](https://repo.maven.apache.org/maven2/io/nexusrpc/nexus-sdk/0.6.0-alpha/nexus-sdk-0.6.0-alpha-sources.jar)

Validation on macOS ARM64: TypeScript typecheck/formatting and JDK reader compilation with isolated Temurin **21.0.13+9**. A temporary native application outside the repository compiled its emitted aggregate with **Maven 3.9.11** and **Gradle 9.2.1** against Temporal SDK **1.40.0**. It included a Workflow with a Signal, inherited grouped Activities with name overrides, an application-owned dependency-bearing Activity, and a Nexus service. That earlier build consumed the now-removed convenience overload; it does not validate the current instance-only signature. Both native builds included the generated source and copied runtime dependencies successfully. `java --dry-run` accepted both emitted classpaths and the discovered named-Worker main class without executing its main method.

No tests, assertion-based self-checks, Worker polling, Linux build, or Windows build was performed. Native build verification does not establish registration execution, readiness, retirement safety, or a compatibility range beyond the inspected release.

Final review validation rebuilt the existing sample through the installed CLI
and Maven 3.9.11 after its authored Worker supplied every Activity/Nexus instance.
The instance-only aggregate compiled successfully. The main method was not run.
