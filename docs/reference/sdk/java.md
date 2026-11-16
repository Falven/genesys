---
title: "Java SDK"
description: "Discover Java definitions, register them with an existing Worker, and build a Maven or Gradle classpath."
---

Use Genesys with a native Temporal Java Worker in a Maven or Gradle project. Your application
creates the Worker, supplies Activity and Nexus instances, and starts its Worker factory.

## Prerequisites

- JDK 17 or later for analysis. Set `JAVA_HOME` or put the JDK's `java` on `PATH`.
- A Maven or Gradle wrapper in the project, or `mvn` or `gradle` on `PATH`.
- Your application's Temporal SDK dependencies and a JDK supported by its native build. The
  build can target a different Java release from the JDK used for analysis.

The Java reader parses copies of the source using the JDK compiler's syntax trees.
It disables annotation processing and reads the local POM without running Maven. Inspection
does not compile or load application classes, invoke factories, or evaluate Gradle. A native
build can execute authored build logic.

## Discover definitions

Place implementations in the `workflows/`, `activities/`, and `nexus/` directories under a
discovery root. Keep Java package names and source paths aligned. Several definitions can share
one entry. Interfaces and helpers can supply contracts and ancestors, including from outside
the recognized entries in the same package context.

| Definition            | Source form                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow              | A concrete implementation of a public `@WorkflowInterface` with a `@WorkflowMethod`. The contract's simple name supplies the default Workflow type. Signals, Queries, Updates, validators, and state stay with the native Workflow.                                                                                |
| Activity              | A concrete implementation of a public `@ActivityInterface`, including inherited methods. Names follow `@ActivityMethod(name = ...)` and `namePrefix`. By default, the SDK capitalizes the first character of each method name. Genesys records one definition per Activity method and registers the instance once. |
| Nexus service handler | An implementation with `@ServiceImpl(service = Contract.class)` and a `@Service` contract. The contract's simple name supplies the default service name. The SDK discovers and validates operation handlers on the supplied instance.                                                                              |
| Dynamic handler       | An implementation of `DynamicWorkflow` or `DynamicActivity` retains its native dynamic identity.                                                                                                                                                                                                                   |

Genesys resolves imports, qualified annotation names, source interfaces, superclass chains,
nested types, and string constants and concatenations from the source it can see. When a name
or generic substitution cannot be resolved statically, the definition can have an unresolved
identity while native registration still uses the implementation's annotations. Use explicit
native assembly for definitions the reader cannot discover or reference, such as Kotlin
implementations, definitions supplied only by external ancestors or annotation processors, and
Nexus services constructed at runtime.

## Register with your Worker

Genesys generates a `genesys.generated.GenesysRegistration_<root hash>` class for each discovery
root with registrations. The suffix is the first 12 hexadecimal digits of the SHA-256 hash
of the root path, relative to the Genesys project and with slash separators. To see the
method signature before wiring it, build once without calling the aggregate and read the
emitted Java file. Call the static `register` method where you assemble your
`io.temporal.worker.Worker`.

For example, in `src/main/java/example/temporal/workers/nativeworker/Main.java`, the discovery
root `src/main/java/example/temporal` produces `GenesysRegistration_c5e2d8aa87be`. After creating
the Worker and the discovered instances, call:

```java
genesys.generated.GenesysRegistration_c5e2d8aa87be.register(
    worker, dependentActivity, groupedActivities, echoService
);
```

Pass every required Activity and Nexus instance, including types with public no-argument
constructors. Use your own constructors or factories. The aggregate takes one argument per
implementation, so a new Activity method on an existing implementation needs no new argument.

For Workflows, the aggregate calls `registerWorkflowImplementationTypes`. The implementation
needs an accessible public no-argument constructor or a public `@WorkflowInit` constructor.
The SDK supplies Workflow input to `@WorkflowInit` and owns Workflow instantiation. The
generated aggregate uses the SDK's production registration API. The inspected
`registerWorkflowImplementationFactory` methods are for testing and mocking.

Use explicit native registration for implementations that a generated class cannot reference
or construct, including private or package-private types, non-static member classes, and types
in the unnamed package. If two definitions in one root have the same identity, including two
dynamic handlers of the same kind, Genesys warns and omits that aggregate. Register the
definitions explicitly in separate native Worker scopes when they belong to different Workers.
The Task Queue and registration scope come from the Worker you pass to the aggregate.

When all registrations share a source root that follows the Java package paths, Genesys emits
the aggregate under that source root in the isolated build. If it cannot infer one source root,
it emits the file under `.gsys/generated/java` in the build's package and reports a diagnostic.
Include that directory in your native source set if you consume the file.

## Build a Worker

Place a `public static void main(String[])` entrypoint in a recognized Worker entry. A nested
class uses its native binary name, such as `example.temporal.workers.nativeworker.Main$Launcher`.
Several candidates in one named Worker directory leave one unresolved launch plan. A named
Worker with no conventional main method also keeps its native package working directory in the
plan. Use an executable override when starting those Workers through Genesys. Give Worker directories
unique selector names for development. Production builds can retain independent Worker programs
with the same name. Use the manifest's Worker ID to identify the command if the name is shared.

Run the build from the application project root:

```sh
gsys build
```

Genesys generates registration in a versioned snapshot and compiles it with the authored main
source set. It selects the nearest matching wrapper within the project, then falls back to the
native launcher on `PATH`. Both builds skip tests.

| Native build | Output                                                                                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maven        | Runs `compile` and `maven-dependency-plugin:3.9.0:copy-dependencies` for runtime dependencies. The classpath uses the POM's resolved `outputDirectory` for classes and resources, plus the JARs in `target/genesys-dependencies`.                                                                     |
| Gradle       | Adds `gsysPrepareWorker` to the Java project whose directory matches the native package. It runs `classes` and copies the evaluated `main.runtimeClasspath` into `build/genesys-worker`. The classpath uses that directory and its JARs. Conflicting files with the same relative path fail the copy. |

For automatic Maven classpath launch, use a JAR project with a project-relative output directory
resolvable from the local POM. Use native startup for parent or profile models, non-JAR modules,
unresolved or external output paths, and reactor-only dependencies. For Gradle, use native
startup if your source sets or layout need a different classpath. Java modules need native
module-path startup.

## Start the built Worker

Follow `.gsys/compile/manifest.json` to the published version's manifest. For a resolved launch,
the Worker entry records the Java executable, arguments, and working directory. Its
`nativeOutput` records the classpath output location and compiled main class. The manifest's
`artifacts` records include runtime JARs and resources produced by the build.

Run the recorded executable and arguments from its `start.cwd` in the retained build. For a
Maven project with `target/worker-classes` as its output directory, the recorded POSIX classpath
has this form:

```sh
java -cp 'target/worker-classes:target/genesys-dependencies/*' 'example.temporal.workers.nativeworker.Main$Launcher'
```

For the same main class in a Gradle project, the classpath has this form:

```sh
java -cp 'build/genesys-worker:build/genesys-worker/*' 'example.temporal.workers.nativeworker.Main$Launcher'
```

Use the argument boundaries and classpath separator recorded for the build. Keep the relative
classpath layout intact and install a JVM that can run the application's bytecode and
dependencies. Supply runtime dependencies and settings through your deployment tools. Your
native project controls any additional archive or distribution layout.

Genesys reports Java readiness as unavailable. To establish readiness, obtain fresh native
heartbeats attributed to the new process and observe successful polling by its intended Workers.
Heartbeats require compatible SDK and server versions and enabled settings. Dynamic Worker
creation can leave coverage unknown. Retirement requires its own native evidence. See the
[readiness and retirement decision](../../adr/0002-separate-readiness-from-retirement.md).

## Verification scope

The inspected registration APIs are from Temporal Java SDK 1.40.0 and its declared Nexus Java
SDK 0.6.0-alpha. See the [Worker API](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/worker/Worker.java),
[Activity metadata](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/common/metadata/POJOActivityInterfaceMetadata.java),
[Workflow metadata](https://github.com/temporalio/sdk-java/blob/v1.40.0/temporal-sdk/src/main/java/io/temporal/common/metadata/POJOWorkflowInterfaceMetadata.java),
and [released dependency versions](https://repo.maven.apache.org/maven2/io/temporal/temporal-sdk/1.40.0/temporal-sdk-1.40.0.pom).

The installed CLI's Java fixture compiled the instance-only aggregate and ran its published
Maven and Gradle commands against local Temporal on macOS arm64. It used Temurin 21.0.13+9,
Maven 3.9.11, Gradle 9.2.1, and Temporal CLI 1.10.0 with Server 1.32.2. The fixture exercised
Workflow Signals, supplied Activity and Nexus instances, and application resources on the
runtime classpath. The runtime evidence applies to those versions and launch paths. It leaves
Java supervisor launch, Linux and Windows execution, and Windows batch wrappers unverified.

## Next steps

See [Project Structure](../../concepts/project-structure.md) for entry locations and
[Native Registration](../../concepts/native-registration.md) for combining generated and
explicit registration.
