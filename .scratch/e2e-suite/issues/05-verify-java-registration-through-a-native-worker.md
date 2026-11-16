# 05: Verify Java registration through a native Worker

**What to build:** A real Java application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small Java native application to exercise annotated interfaces and inherited methods, supplied implementation objects, native visibility, Maven/Gradle entrypoints and generated Nexus wiring; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.

## Comments

Implemented three cases in [05-installed-java.test.ts](../../../e2e/05-installed-java.test.ts). The reusable [native Java package](../../../e2e/fixtures/java) contains `src` and `runtime` plus either `pom.xml` or the three Gradle files. If the project moves under another discovery root, use that root's generated aggregate class in `Main.java`. The Worker and Java Client accept `TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE`. The authored Task Queue and Nexus endpoint are both `genesys-java`.

- D01–D07. Installed inspection leaves the application initializer, constructor, and Gradle configuration hook idle. It reports both definitions in one Workflow entry, preserves inherited and overridden Activity names, ignores a native test definition, and preserves a Workflow identity after a file move. A JDK-owned annotation constant is unresolved. A nonpublic annotated interface is invalid. Missing and ambiguous main methods produce distinct diagnostics. Maven builds a second aggregate with the same Workflow name in an independent discovery root, then rejects the same name within one aggregate and exposes both definition paths.
- R01–R05, R07. The published Maven and Gradle commands launch the nested Java main class from each immutable manifest. The Java Client sends a named Signal and receives a result from inherited, supplied, and explicitly registered Activities plus two generated Nexus operations. The supplied Nexus instance returns a value from one operation and rejects the other with its authored message, service, and operation names. Maven publishes separate pre-edit and post-edit aggregates. Both builds serve their matching Workflow after the authored definition changes.
- R08. Maven resolves a POM-defined class directory and packages runtime JARs. Gradle assembles the evaluated runtime classpath and includes the authored resource directory. Both published builds use that resource for Activity construction and Worker identity. The Java Client verifies the Worker identity and authored codec metadata in native Workflow history.

Passed all three cases on macOS 27.2.1 arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Temurin 21.0.13+9, Maven 3.9.11, Gradle 9.2.1, Temporal CLI 1.10.0 with Server 1.32.2, Temporal Java SDK 1.40.0 with Nexus SDK 0.6.0-alpha, and gsys 0.0.0.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 05-installed-java
pnpm exec tsc --ignoreConfig --noEmit --strict --module nodenext --types node e2e/05-installed-java.test.ts
pnpm exec oxfmt --check e2e/05-installed-java.test.ts
git diff --cached --check
```

The initial baseline emitted Maven and Gradle progress before the build JSON on stdout. Java execution uses the documented published selector and immutable manifest. Linux, Windows, alternate SDK versions, and Java supervisor launch remain unverified by these cases.

### Main integration, 2026-11-16

After merging product commit `2e61166`, the original inspection case failed because a missing `main` now retains the named Worker plan. Maven and Gradle both failed to compile the old call because the generated method now requires `GroupedImpl`. The authored Worker supplies that instance, and both builds verify that the aggregate exports one `register` method. The shared Java fixture keeps the same native Client contract for case 20.

The inspection case now checks that missing and ambiguous entrypoints each retain one Maven build plan and the native package working directory, with no inferred start command. The ambiguity warning identifies both source paths and calls for an executable override. A package-private Workflow contract still fails inspection. Maven also compiles the authored registration after a same-root Workflow collision. The published manifest retains both colliding definitions and the independent root's aggregate. The warning names the duplicate Workflow type and the aggregate that Genesys omits.

All three Java cases passed in 29.03 seconds on macOS 27.2.1 arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Temurin 21.0.13+9, Maven 3.9.11, Gradle 9.2.1, Temporal CLI 1.10.0 with Server 1.32.2, Java SDK 1.40.0, Nexus SDK 0.6.0-alpha, and gsys 0.0.0. Maven and Gradle each served the Java Client from the published launch command. This run compiled the collision fallback and exercised the ordinary published start commands.

```sh
export JAVA_HOME=/tmp/genesys-java-tooling/jdk-21.0.13+9/Contents/Home
export PATH=/Users/falven/.nvm/versions/node/v26.13.1/bin:$JAVA_HOME/bin:/tmp/genesys-java-tooling/apache-maven-3.9.11/bin:/tmp/genesys-java-tooling/gradle-9.2.1/bin:$PATH
export GRADLE_USER_HOME=/tmp/genesys-java-tooling/gradle-home
export MAVEN_OPTS=-Dmaven.repo.local=/tmp/genesys-java-tooling/m2
pnpm install --frozen-lockfile
pnpm test:e2e 05-installed-java
pnpm exec tsc --ignoreConfig --noEmit --strict --module nodenext --types node e2e/05-installed-java.test.ts
pnpm exec oxfmt --check e2e/05-installed-java.test.ts
git diff --cached --check
```
