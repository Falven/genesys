import { Connection } from "@temporalio/client";
import { access, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/java/", import.meta.url));
const javaRoot = "src/main/java";
const temporalRoot = `${javaRoot}/example/temporal`;
const workerPath = `${temporalRoot}/workers/nativeworker/Main.java`;
const greetingPath = `${temporalRoot}/workflows/Greeting.java`;
const implementationPath = `${temporalRoot}/workflows/GreetingImpl.java`;
const registrationPath = `${javaRoot}/genesys/generated/GenesysRegistration_c5e2d8aa87be.java`;
const isolatedRegistrationPath = `${javaRoot}/genesys/generated/GenesysRegistration_9c021c1b1f7e.java`;
const maven = ["mvn", "--version"] as const;
const gradle = ["gradle", "--version"] as const;
const jdk = ["java", "--version"] as const;
type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function copyJava(project: string, build: "Maven" | "Gradle") {
  const manifests =
    build === "Maven" ? ["pom.xml"] : ["build.gradle", "settings.gradle", "gradle.properties"];
  for (const entry of ["src", "runtime", ...manifests])
    await cp(join(source, entry), join(project, entry), { recursive: true });
}

test("Java inspection preserves grouped native identities and reports unresolved, invalid and ambiguous source", async () => {
  await withFixture([jdk, maven], async (fixture) => {
    await copyJava(fixture.project, "Maven");
    const implementation = join(fixture.project, implementationPath);
    const original = await readFile(implementation, "utf8");
    const marker = join(fixture.project, "application-executed");
    await writeFile(
      join(fixture.project, temporalRoot, "workflows/IgnoredTest.java"),
      "package example.temporal.workflows; public class IgnoredTest extends GreetingImpl {}",
    );
    await writeFile(
      implementation,
      original.replace(
        "private String state;",
        `static { touch(); }
        public GreetingImpl() { touch(); }
        private static void touch() {
            try { java.nio.file.Files.writeString(java.nio.file.Path.of(${JSON.stringify(marker)}), "ran"); }
            catch (java.io.IOException error) { throw new RuntimeException(error); }
        }
        private String state;`,
      ),
    );
    const inspected = await fixture.gsys(["inspect"]);
    expect(inspected.code).toBe(0);
    const manifest: unknown = JSON.parse(inspected.stdout);
    expect(manifest).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          symbol: "example.temporal.workflows.GreetingImpl",
          identity: { state: "resolved", name: "JavaGreeting" },
          source: expect.objectContaining({ path: implementationPath }),
        }),
        expect.objectContaining({
          kind: "workflow",
          symbol: "example.temporal.workflows.GreetingImpl.BeforeImpl",
          identity: { state: "resolved", name: "BeforeBuild" },
          source: expect.objectContaining({ path: implementationPath }),
        }),
        ...[
          ["GroupedImpl.first", "Group_First"],
          ["GroupedImpl.second", "Other"],
          ["DependentImpl.configured", "Configured"],
          ["GroupedImpl.Explicit.value", "Explicit"],
        ].map(([method, name]) =>
          expect.objectContaining({
            kind: "activity",
            symbol: `example.temporal.activities.${method}`,
            identity: { state: "resolved", name },
          }),
        ),
        expect.objectContaining({
          kind: "nexus",
          symbol: "example.temporal.nexus.EchoImpl",
          identity: { state: "resolved", name: "EchoService" },
        }),
      ]),
      workers: [
        expect.objectContaining({
          name: "nativeworker",
          language: "java",
          source: expect.objectContaining({ path: workerPath }),
        }),
      ],
    });
    if (!manifest || typeof manifest !== "object" || !("definitions" in manifest))
      throw new Error("Inspection did not publish definitions");
    expect(manifest.definitions).toHaveLength(7);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });

    const movedDirectory = `${temporalRoot}/workflows/reorganized`;
    await mkdir(join(fixture.project, movedDirectory));
    const moved = `${movedDirectory}/GreetingImpl.java`;
    await rename(implementation, join(fixture.project, moved));
    const renamed = await fixture.gsys(["inspect"]);
    expect(renamed.code).toBe(0);
    expect(JSON.parse(renamed.stdout)).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          identity: { state: "resolved", name: "JavaGreeting" },
          source: expect.objectContaining({ path: moved }),
        }),
      ]),
    });
    // The static reader cannot see the JDK's compile-time constant.
    const contract = join(fixture.project, greetingPath);
    const greeting = await readFile(contract, "utf8");
    await writeFile(
      contract,
      greeting.replace('"Java" + "Greeting"', "javax.xml.XMLConstants.XML_NS_PREFIX"),
    );
    const unresolved = await fixture.gsys(["inspect"]);
    expect(unresolved.code).toBe(0);
    expect(unresolved.stderr).toContain("warning java.identity-unresolved");
    expect(JSON.parse(unresolved.stdout)).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          symbol: "example.temporal.workflows.GreetingImpl",
          identity: expect.objectContaining({ state: "unresolved" }),
        }),
      ]),
    });

    const worker = join(fixture.project, workerPath);
    const main = await readFile(worker, "utf8");
    await writeFile(worker, main.replace("void main(", "void start("));
    const missing = await fixture.gsys(["inspect"]);
    expect(missing.code).toBe(0);
    expect(missing.stderr).toContain(`warning java.entrypoint-unresolved ${workerPath}`);
    const missingPlan: unknown = JSON.parse(missing.stdout);
    expect(missingPlan).toMatchObject({
      workers: [
        expect.objectContaining({
          name: "nativeworker",
          language: "java",
          source: { path: workerPath },
          workingDirectory: ".",
          build: [expect.objectContaining({ executable: "mvn", cwd: "." })],
        }),
      ],
    });
    expect(missingPlan).not.toHaveProperty("workers.0.start");
    await writeFile(worker, main);

    const alternate = `${temporalRoot}/workers/nativeworker/Alternate.java`;
    await writeFile(
      join(fixture.project, alternate),
      `package example.temporal.workers.nativeworker;
      public class Alternate { public static void main(String[] args) {} }`,
    );
    const ambiguous = await fixture.gsys(["inspect"]);
    expect(ambiguous.code).toBe(0);
    expect(ambiguous.stderr).toContain("warning java.entrypoint-ambiguous");
    expect(ambiguous.stderr).toContain("supply an executable override");
    const ambiguousPlan: unknown = JSON.parse(ambiguous.stdout);
    expect(ambiguousPlan).toMatchObject({
      workers: [
        expect.objectContaining({
          name: "nativeworker",
          workingDirectory: ".",
          build: [expect.objectContaining({ executable: "mvn", cwd: "." })],
        }),
      ],
    });
    expect(ambiguousPlan).not.toHaveProperty("workers.0.start");
    expect(
      JSON.parse(await readFile(join(fixture.project, ".gsys/discovery/diagnostics.json"), "utf8")),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "java.entrypoint-ambiguous",
          severity: "warning",
          source: expect.objectContaining({ path: alternate }),
          related: [expect.objectContaining({ path: workerPath })],
        }),
      ]),
    );

    await writeFile(contract, greeting.replace("public interface Greeting", "interface Greeting"));
    const invalid = await fixture.gsys(["inspect"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("error java.contract-visibility");
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
}, 360_000);

async function startTemporal(fixture: Fixture) {
  const endpoint = await temporalEndpoint();
  fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
  const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "20s" });
  try {
    await connection.ensureConnected();
    await expect
      .poll(
        () =>
          connection.withDeadline(Date.now() + 2_000, () =>
            connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
  } finally {
    await connection.close();
  }
  const nexus = await fixture.run("temporal", [
    "operator",
    "nexus",
    "endpoint",
    "create",
    "--address",
    endpoint.address,
    "--disable-config-env",
    "--disable-config-file",
    "--name",
    "genesys-java",
    "--target-namespace",
    endpoint.namespace,
    "--target-task-queue",
    "genesys-java",
  ]);
  expect(nexus.code).toBe(0);
  return endpoint;
}

async function buildJava(fixture: Fixture) {
  const result = await fixture.gsys(["build"], { timeout: 220_000 });
  expect(result.code).toBe(0);
  expect(result.stderr).toContain("warning java.registration-visibility");
  const published: unknown = JSON.parse(
    await readFile(join(fixture.project, ".gsys/compile/manifest.json"), "utf8"),
  );
  expect(published).toMatchObject({
    artifacts: expect.arrayContaining([
      { kind: "registration", path: registrationPath, entry: expect.any(Object) },
    ]),
  });
  if (
    !published ||
    typeof published !== "object" ||
    !("manifestPath" in published) ||
    typeof published.manifestPath !== "string"
  )
    throw new Error("Build did not publish an immutable manifest path");
  const manifest: unknown = JSON.parse(await readFile(published.manifestPath, "utf8"));
  expect(manifest).toEqual(published);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("root" in manifest) ||
    typeof manifest.root !== "string" ||
    !("workers" in manifest) ||
    !Array.isArray(manifest.workers)
  )
    throw new Error("Immutable manifest is missing its root or Workers");
  const [worker]: unknown[] = manifest.workers;
  if (
    !worker ||
    typeof worker !== "object" ||
    !("start" in worker) ||
    !worker.start ||
    typeof worker.start !== "object"
  )
    throw new Error("Immutable manifest is missing the Worker start command");
  const { start } = worker;
  if (
    !("executable" in start) ||
    typeof start.executable !== "string" ||
    !("cwd" in start) ||
    typeof start.cwd !== "string" ||
    !("args" in start) ||
    !Array.isArray(start.args) ||
    !start.args.every((arg: unknown) => typeof arg === "string")
  )
    throw new Error("Immutable manifest has an invalid Java start command");
  expect(start.cwd).toBe(manifest.root);
  expect(start.args.at(-1)).toBe("example.temporal.workers.nativeworker.Main$Launcher");
  const registration = await readFile(join(manifest.root, registrationPath), "utf8");
  expect(registration.match(/\bstatic void register\(/g)).toHaveLength(1);
  return {
    root: manifest.root,
    executable: start.executable,
    cwd: start.cwd,
    args: start.args,
    registration,
  };
}

async function runJava(
  fixture: Fixture,
  launch: Awaited<ReturnType<typeof buildJava>>,
  endpoint: Awaited<ReturnType<typeof temporalEndpoint>>,
  revision: "before" | "after",
) {
  const { cwd, executable, args } = launch;
  const worker = fixture.start(executable, args, { cwd, env: endpoint.workerEnv });
  try {
    const result = await fixture.run(
      executable,
      [
        ...args.slice(0, -1),
        "example.temporal.lib.NativeClient",
        revision === "before" ? "BeforeBuild" : "AfterBuild",
      ],
      { cwd, env: endpoint.workerEnv, timeout: 110_000 },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      "inherited:Genesys|overridden|authored|explicit|nexus:signal|EchoService/Reject:nexus rejected signal",
      "genesys-java-native",
      "authored",
      revision,
    ]);
  } finally {
    await worker.stop();
  }
}

test("Maven Java launch uses authored output paths and generated registration follows definition edits and scopes", async () => {
  await withFixture([jdk, maven, ["temporal", "--version"]], async (fixture) => {
    await copyJava(fixture.project, "Maven");
    const separateScope = join(fixture.project, javaRoot, "isolated/temporal/workflows");
    await mkdir(separateScope, { recursive: true });
    const alias = join(separateScope, "Alias.java");
    await writeFile(
      alias,
      `package isolated.temporal.workflows;
      public class Alias extends example.temporal.workflows.GreetingImpl {}`,
    );

    const before = await buildJava(fixture);
    expect(before.registration).toContain("GreetingImpl.BeforeImpl.class");
    expect(before.registration).not.toContain("GroupedImpl.Explicit");
    expect(before.args).toContainEqual(expect.stringContaining("target/worker-classes"));
    await expect(readFile(join(before.root, isolatedRegistrationPath), "utf8")).resolves.toContain(
      "isolated.temporal.workflows.Alias.class",
    );

    const implementation = join(fixture.project, implementationPath);
    const contract = join(fixture.project, greetingPath);
    const original = await readFile(implementation, "utf8");
    const greeting = await readFile(contract, "utf8");
    await writeFile(
      implementation,
      original.replaceAll("Before", "After").replace('"before"', '"after"'),
    );
    await writeFile(contract, greeting.replaceAll("Before", "After"));
    const after = await buildJava(fixture);
    expect(after.registration).toContain("GreetingImpl.AfterImpl.class");
    expect(after.registration).not.toContain("GreetingImpl.BeforeImpl.class");
    expect(after.root).not.toBe(before.root);
    await expect(access(join(fixture.project, registrationPath))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const endpoint = await startTemporal(fixture);
    await runJava(fixture, before, endpoint, "before");
    await runJava(fixture, after, endpoint, "after");

    const collisionPath = `${temporalRoot}/workflows/Alias.java`;
    await writeFile(
      join(fixture.project, collisionPath),
      "package example.temporal.workflows; public class Alias extends GreetingImpl {}",
    );
    const launcher = join(fixture.project, workerPath);
    const main = await readFile(launcher, "utf8");
    await writeFile(
      launcher,
      main
        .replace(
          "import genesys.generated.GenesysRegistration_c5e2d8aa87be;",
          "import example.temporal.workflows.GreetingImpl;",
        )
        .replace(
          /GenesysRegistration_c5e2d8aa87be\.register\(worker,[\s\S]*?\);/,
          `worker.registerWorkflowImplementationTypes(GreetingImpl.class, GreetingImpl.AfterImpl.class);
            worker.registerActivitiesImplementations(
                    new DependentImpl(settings.getProperty("activityPrefix")), new GroupedImpl());
            worker.registerNexusServiceImplementation(new EchoImpl("nexus"));`,
        ),
    );
    const conflict = await fixture.gsys(["build"]);
    expect(conflict.code).toBe(0);
    expect(conflict.stderr).toContain("warning java.aggregate-collision");
    expect(conflict.stderr).toContain("workflow:JavaGreeting");
    const conflicted: unknown = JSON.parse(
      await readFile(join(fixture.project, ".gsys/compile/manifest.json"), "utf8"),
    );
    expect(conflicted).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: "registration", path: isolatedRegistrationPath }),
      ]),
      discovery: {
        definitions: expect.arrayContaining(
          [implementationPath, collisionPath].map((path) =>
            expect.objectContaining({
              identity: { state: "resolved", name: "JavaGreeting" },
              source: expect.objectContaining({ path }),
            }),
          ),
        ),
      },
    });
    expect(conflicted).not.toMatchObject({
      artifacts: expect.arrayContaining([expect.objectContaining({ path: registrationPath })]),
    });
  });
}, 720_000);

test("Gradle inspection leaves build hooks idle and the published runtime classpath serves native work", async () => {
  await withFixture([jdk, gradle, ["temporal", "--version"]], async (fixture) => {
    await copyJava(fixture.project, "Gradle");
    const inspection = await fixture.gsys(["inspect"]);
    expect(inspection.code).toBe(0);
    expect(JSON.parse(inspection.stdout)).toMatchObject({
      workers: [
        expect.objectContaining({
          name: "nativeworker",
          build: [expect.objectContaining({ args: expect.arrayContaining(["gsysPrepareWorker"]) })],
        }),
      ],
    });
    await expect(access(join(fixture.project, "gradle-configured"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const launch = await buildJava(fixture);
    expect(launch.args).toContainEqual(expect.stringContaining("build/genesys-worker"));
    await expect(readFile(join(launch.root, "gradle-configured"), "utf8")).resolves.toBe(
      "evaluated",
    );
    await runJava(fixture, launch, await startTemporal(fixture), "before");
  });
}, 480_000);
