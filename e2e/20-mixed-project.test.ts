import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, cp, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { Language } from "../packages/genesys/src/contracts.js";
import { temporalEndpoint, withFixture } from "./fixture.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const goWorkflow = "temporal/workflows/greeting.go";
const pythonWorker = "src/python_probe/temporal/workers/greeting/main.py";
const javaWorker = "src/main/java/example/temporal/workers/nativeworker/Main.java";
const phpRegistration = ".gsys/compile/php/4d877902a2aac560/registration.php";
const rustRegistration = ".gsys/compile/rust/2aae92e5a8c9bd6a/registration";

interface PackageFixture {
  source: string;
  manifests: string[];
  workers: [name: string, source: string, executable: string, cwd?: string][];
  registration: string;
  nativeOutput?: string | RegExp;
  tools?: [executable: string, ...args: string[]][];
}

const packages: Record<Language, PackageFixture> = {
  go: {
    source: "go-registration",
    manifests: ["go.mod"],
    workers: [["orders", "temporal/workers/orders/main.go", ""]],
    registration: "apps/go/temporal/gsysregistration/registration.go",
    nativeOutput: /^\.gsys\/native\/go\/.+\/orders$/,
    tools: [["go", "version"]],
  },
  python: {
    source: "python",
    manifests: ["pyproject.toml"],
    workers: [["greeting", pythonWorker, ""]],
    registration: ".gsys/compile/python/0af0f7ba5c65/gsys_generated_f525a4c50a2a/activities.py",
    nativeOutput: "apps/python/.gsys/python-env/bin/genesys-python-worker",
    tools: [["python3", "--version"]],
  },
  typescript: {
    source: "typescript-native/app",
    manifests: ["package.json"],
    workers: [["typescript-orders", "workers/typescript-orders/index.ts", "node"]],
    registration: "apps/typescript/temporal/genesys-workflows.mts",
    nativeOutput: "apps/typescript/dist/workers/typescript-orders/index.js",
  },
  java: {
    source: "java",
    manifests: ["pom.xml"],
    workers: [["nativeworker", javaWorker, "java"]],
    registration: "apps/java/src/main/java/genesys/generated/GenesysRegistration_9b1f2961dca3.java",
    nativeOutput: "apps/java/target/worker-classes/java-worker.properties",
    tools: [
      ["javac", "-version"],
      ["mvn", "--version"],
    ],
  },
  dotnet: {
    source: "dotnet",
    manifests: ["Worker.csproj"],
    workers: [["dotnet", "temporal/workers/dotnet/Program.cs", "dotnet", "."]],
    registration: "apps/dotnet/GenesysRegistration.g.cs",
    nativeOutput: /^\.gsys\/dotnet\/.+\/Genesys\.DotnetFixture\.dll$/,
    tools: [["dotnet", "--version"]],
  },
  php: {
    source: "php",
    manifests: ["composer.json"],
    workers: [["php-native", "workers/php-native/.rr.yaml", "rr", "apps/php/workers/php-native"]],
    registration: phpRegistration,
    nativeOutput: "apps/php/vendor/autoload.php",
    tools: [
      ["php", "--version"],
      ["composer", "--version"],
      ["rr", "--version"],
    ],
  },
  ruby: {
    source: "ruby",
    manifests: ["Gemfile"],
    workers: [["ruby-greeting", "bin/ruby-greeting", "bundle"]],
    registration: "apps/ruby/.gsys/ruby/registration.rb",
    tools: [
      ["ruby", "--version"],
      ["bundle", "--version"],
    ],
  },
  rust: {
    source: "rust",
    manifests: ["Cargo.toml"],
    workers: [
      ["genesys-rust-native", "src/main.rs", "cargo"],
      ["feature-probe", "src/bin/feature_probe.rs", "cargo"],
    ],
    registration: `${rustRegistration}/7cb028dcb66a522c.rs`,
    nativeOutput: /\/target\/debug\/genesys-rust-native$/,
    tools: [
      ["cargo", "--version"],
      ["rustc", "--version"],
      [process.env.PROTOC ?? "protoc", "--version"],
    ],
  },
};

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function compose(fixture: Fixture, languages: readonly Language[]) {
  const app = (language: Language, path = "") => join(fixture.project, "apps", language, path);
  async function replace(language: Language, path: string, from: string, to: string) {
    const destination = app(language, path);
    const authored = await readFile(destination, "utf8");
    expect(authored, path).toContain(from);
    await writeFile(destination, authored.replaceAll(from, to));
  }

  for (const language of languages) {
    const source = join(fixtures, packages[language].source);
    if (language === "java") {
      for (const path of ["src", "runtime", "pom.xml"])
        await cp(join(source, path), app(language, path), { recursive: true });
    } else {
      await cp(source, app(language), { recursive: true });
    }
  }

  await cp(join(fixtures, "mixed-project/greeting.go"), app("go", goWorkflow));
  await replace(
    "python",
    pythonWorker,
    "gsys_generated_5909144ccd67",
    "gsys_generated_f525a4c50a2a",
  );

  if (languages.includes("typescript")) {
    await rename(
      app("typescript", "workers/orders"),
      app("typescript", "workers/typescript-orders"),
    );
    const installed = await fixture.run("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: app("typescript"),
    });
    expect(installed.code).toBe(0);
  }
  if (languages.includes("java"))
    await replace(
      "java",
      javaWorker,
      "GenesysRegistration_c5e2d8aa87be",
      "GenesysRegistration_9b1f2961dca3",
    );
  if (languages.includes("ruby")) {
    const installed = await fixture.run("bundle", ["install"], {
      cwd: app("ruby"),
      env: { BUNDLE_FROZEN: "true" },
    });
    expect(installed.code).toBe(0);
  }
  if (languages.includes("rust"))
    for (const path of ["src/temporal/activities/mod.rs", "src/temporal/workflows/mod.rs"])
      await replace(
        "rust",
        path,
        ".gsys/compile/rust/6a7af8d7cf6e19cc/registration",
        `../../${rustRegistration}`,
      );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function launchPlan(worker: unknown) {
  const start = record(worker) ? worker.start : undefined;
  assert(record(start) && typeof start.executable === "string" && typeof start.cwd === "string");
  assert(Array.isArray(start.args));
  const args: unknown[] = start.args;
  assert(args.every((arg): arg is string => typeof arg === "string"));
  const env: NodeJS.ProcessEnv = {};
  if (start.env !== undefined) {
    assert(record(start.env));
    for (const [key, value] of Object.entries(start.env)) {
      assert(typeof value === "string");
      env[key] = value;
    }
  }
  return { executable: start.executable, args, cwd: start.cwd, env };
}

async function mixedProject(languages: readonly Language[]) {
  const tools = languages.flatMap((language) => packages[language].tools ?? []);
  await withFixture([["temporal", "--version"], ...tools], async (fixture) => {
    await compose(fixture, languages);
    const inspection = await fixture.gsys(["inspect"], { timeout: 120_000 });
    expect(inspection.code).toBe(0);
    const inspected: unknown = JSON.parse(inspection.stdout);
    const expectedPackages = languages.map((language) => ({
      id: `${language}:apps/${language}`,
      language,
      root: `apps/${language}`,
      manifests: expect.arrayContaining(
        packages[language].manifests.map((path) => `apps/${language}/${path}`),
      ),
    }));
    const workerSpecs = languages.flatMap((language) => {
      return packages[language].workers.map(
        ([name, path, executable, cwd = `apps/${language}`]) => ({
          language,
          name,
          source: { path: `apps/${language}/${path}` },
          packageId: `${language}:apps/${language}`,
          executable,
          cwd,
        }),
      );
    });
    const workerIdentities = workerSpecs.map(({ language, name, source, packageId }) =>
      expect.objectContaining({
        language,
        name,
        source: expect.objectContaining(source),
        packageId,
      }),
    );
    expect(inspected).toMatchObject({
      packages: expect.arrayContaining(
        expectedPackages.map((spec) => expect.objectContaining(spec)),
      ),
      workers: expect.arrayContaining(workerIdentities),
    });
    assert(
      record(inspected) && Array.isArray(inspected.packages) && Array.isArray(inspected.workers),
    );
    expect(inspected.packages).toHaveLength(languages.length);
    expect(inspected.workers).toHaveLength(workerSpecs.length);
    const greetings = [
      ["go", goWorkflow],
      ["python", "src/python_probe/temporal/workflows/greeting.py"],
    ].map(([language, source]) => {
      const path = `apps/${language}/${source}`;
      return { language, path, packageId: `${language}:apps/${language}` };
    });
    for (const { language, path, packageId } of greetings) {
      expect(inspected).toMatchObject({
        entries: expect.arrayContaining([expect.objectContaining({ id: path, path, packageId })]),
        definitions: expect.arrayContaining([
          expect.objectContaining({
            language,
            kind: "workflow",
            entryId: path,
            identity: { state: "resolved", name: "Greeting" },
          }),
        ]),
      });
    }

    const published = await fixture.gsys(["build"], { timeout: 480_000 });
    expect(published.code).toBe(0);
    const build: unknown = JSON.parse(
      await readFile(join(fixture.project, ".gsys/compile/manifest.json"), "utf8"),
    );
    assert(record(build));
    assert(
      typeof build.id === "string" &&
        typeof build.root === "string" &&
        typeof build.manifestPath === "string",
    );
    assert(Array.isArray(build.workers) && Array.isArray(build.artifacts));
    const version = join(await realpath(fixture.project), ".gsys/compile/builds", build.id);
    const root = join(version, "project");
    expect(build.root).toBe(root);
    expect(build.manifestPath).toBe(join(version, "manifest.json"));
    expect(JSON.parse(await readFile(build.manifestPath, "utf8"))).toEqual(build);
    expect(build.workers).toHaveLength(workerSpecs.length);
    expect(build.workers).toEqual(expect.arrayContaining(workerIdentities));

    const artifacts: unknown[] = build.artifacts;
    async function checkArtifact(kind: string, pattern: string | RegExp) {
      const artifact = artifacts.find(
        (item) =>
          record(item) &&
          item.kind === kind &&
          typeof item.path === "string" &&
          (typeof pattern === "string" ? item.path === pattern : pattern.test(item.path)),
      );
      assert(
        record(artifact) && typeof artifact.path === "string",
        `Missing ${kind} in published build: ${pattern}`,
      );
      const path = join(root, artifact.path);
      await access(path);
      return path;
    }
    const outputs = new Map<Language, string>();
    for (const language of languages) {
      const { registration, nativeOutput } = packages[language];
      await checkArtifact("registration", registration);
      if (nativeOutput) outputs.set(language, await checkArtifact("native-output", nativeOutput));
    }

    const endpoint = await temporalEndpoint();
    fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
    const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
    try {
      await connection.ensureConnected();
      await expect
        .poll(
          () =>
            connection.withDeadline(Date.now() + 5_000, () =>
              connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
            ),
          { timeout: 15_000 },
        )
        .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });

      const createNexusEndpoint = (name: string, taskQueue: string) =>
        connection.withDeadline(Date.now() + 10_000, () =>
          connection.operatorService.createNexusEndpoint({
            spec: { name, target: { worker: { namespace: endpoint.namespace, taskQueue } } },
          }),
        );
      const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
      const start = (taskQueue: string, name: string, args: unknown[] = []) =>
        client.start(name, {
          taskQueue,
          args,
          workflowId: randomUUID(),
          workflowExecutionTimeout: "35s",
        });

      const workerRecords: unknown[] = build.workers;
      const phpRpc = languages.includes("php") ? await temporalEndpoint() : undefined;
      const plans = new Map(
        workerSpecs.map((spec) => {
          const launch = launchPlan(
            workerRecords.find(
              (recordValue) => record(recordValue) && recordValue.name === spec.name,
            ),
          );
          expect(launch.cwd, spec.name).toBe(join(root, spec.cwd));
          if (spec.executable) expect(basename(launch.executable), spec.name).toBe(spec.executable);
          else expect(launch.executable, spec.name).toBe(outputs.get(spec.language));
          const env: NodeJS.ProcessEnv = { ...endpoint.workerEnv, ...launch.env };
          if (spec.language === "python")
            expect(env.PYTHONPATH?.split(delimiter)).toEqual([
              join(root, spec.cwd, "src"),
              dirname(dirname(join(root, packages.python.registration))),
            ]);
          if (spec.language === "php" && phpRpc) {
            env.GENESYS_PHP_RPC_PORT = String(phpRpc.port);
            env.GENESYS_PHP_REGISTRATION = join(root, phpRegistration);
          }
          return [spec.name, { ...launch, env }];
        }),
      );
      for (const [name, plan] of plans) {
        const worker = fixture.start(plan.executable, plan.args, plan);
        // The fixture's additional Cargo target is an executable one-shot probe.
        if (name === "feature-probe")
          expect(await worker.wait(60_000)).toMatchObject({
            code: 0,
            stdout: expect.stringContaining("Cargo feature probe enabled"),
          });
      }

      await connection.withDeadline(Date.now() + 55_000, async () => {
        // The result requires the Python Worker's generated bound Activity and authored interceptor.
        const go = await start("orders", "Greeting", ["Ada"]);
        await expect(go.result()).resolves.toBe("intercepted/Hello, Ada!");

        // The same native Workflow identity is independently routable to Python.
        await createNexusEndpoint("mixed-python", "genesys-python");
        const python = await start("genesys-python", "Greeting", ["mixed-python"]);
        await python.executeUpdate("ChooseName", { args: ["Ada"] });
        await expect(python.result()).resolves.toEqual([
          "intercepted/Hello, Ada!",
          "explicit/Ada",
          "Hello/echo/Ada",
          expect.stringContaining("Hello/reject/Ada"),
        ]);
      });

      if (languages.includes("typescript")) {
        const workflow = await start("ts-native", "Checkout");
        await workflow.executeUpdate("approve", { args: [" beans "] });
        await expect(workflow.result()).resolves.toEqual([
          "intercepted:orders:BEANS",
          "intercepted:commonjs:BEANS",
          "intercepted:authored:BEANS",
        ]);
      }
      if (languages.includes("java")) {
        await createNexusEndpoint("genesys-java", "genesys-java");
        const plan = plans.get("nativeworker");
        assert(plan);
        const java = await fixture.run(
          plan.executable,
          [...plan.args.slice(0, -1), "example.temporal.lib.NativeClient", "BeforeBuild"],
          { ...plan, timeout: 85_000 },
        );
        expect(java.code).toBe(0);
        expect(java.stdout.trim().split(/\r?\n/)).toEqual([
          "inherited:Genesys|overridden|authored|explicit|nexus:signal|EchoService/Reject:nexus rejected signal",
          "genesys-java-native",
          "authored",
          "before",
        ]);
      }
      if (languages.includes("dotnet"))
        await expect((await start("dotnet-raw", "RetiredJob")).result()).resolves.toBe("retired");
      if (languages.includes("php")) {
        const workflow = await start("genesys-php", "php.greet", ["Genesys"]);
        await workflow.signal("php.release");
        await expect(workflow.result()).resolves.toBe("intercepted: factory Genesys!");
      }
      if (languages.includes("ruby")) {
        const workflow = await start("ruby-greetings", "RubyGreeting");
        await workflow.signal("release_greeting", "Genesys");
        await expect(workflow.result()).resolves.toEqual([
          "intercepted(Hello, Genesys)",
          "intercepted(!)",
          "intercepted(explicit)",
        ]);
      }
      if (languages.includes("rust")) {
        const workflow = await start("rust-native-e2e", "WithFactory");
        await workflow.signal("release", "signaled");
        await expect(workflow.result()).resolves.toBe("instance:factory-intercepted:42:signaled");
      }
    } finally {
      await connection.close();
    }
  });
}

test(
  "Go and Python preserve cross-package calls and equal native names",
  () => mixedProject(["go", "python"]),
  720_000,
);

test(
  "all eight SDKs retain their own package, build, and launch context in one project",
  () => mixedProject(["go", "python", "typescript", "java", "dotnet", "php", "ruby", "rust"]),
  900_000,
);
