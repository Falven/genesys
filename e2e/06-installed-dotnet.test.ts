import { Connection } from "@temporalio/client";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/dotnet/", import.meta.url));
const packagePath = "dotnet app";
const workerFile = "temporal/workers/dotnet/Program.cs";
const oldJob = "features/temporal/workflows/RetiredJob.cs";
const newJob = "features/temporal/workflows/NewJob.cs";
const generated = `${packagePath}/GenesysRegistration.g.cs`;
const selectedManifest = ".gsys/compile/manifest.json";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workerCommand(manifest: unknown) {
  if (!record(manifest) || typeof manifest.root !== "string" || !Array.isArray(manifest.workers))
    throw new Error("Published build is missing its root or Workers");
  const worker: unknown = manifest.workers[0];
  const start = record(worker) ? worker.start : undefined;
  if (
    !record(start) ||
    typeof start.executable !== "string" ||
    typeof start.cwd !== "string" ||
    !Array.isArray(start.args) ||
    !start.args.every((value: unknown): value is string => typeof value === "string")
  )
    throw new Error("Published Worker is missing its native command");
  if (start.env !== undefined && !record(start.env))
    throw new Error("Published Worker environment is invalid");
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(start.env ?? {})) {
    if (typeof value !== "string") throw new Error(`Invalid published environment entry ${key}`);
    env[key] = value;
  }

  expect(start.cwd).toBe(manifest.root);
  const args: string[] = start.args;
  return { root: manifest.root, executable: start.executable, cwd: start.cwd, args, env };
}

async function publishedWorker(project: string) {
  const manifest: unknown = JSON.parse(await readFile(join(project, selectedManifest), "utf8"));
  const command = workerCommand(manifest);
  const [assembly] = command.args;
  expect(command.args).toHaveLength(1);
  if (assembly === undefined) throw new Error("Published Worker is missing its assembly argument");
  expect(basename(assembly)).toBe("Genesys.DotnetFixture.dll");
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    workers: [{ name: "dotnet", language: "dotnet", start: { executable: "dotnet" } }],
    artifacts: expect.arrayContaining([
      expect.objectContaining({ path: generated, kind: "registration" }),
      ...[
        "Genesys.DotnetFixture.deps.json",
        "Genesys.DotnetFixture.dll",
        "Genesys.DotnetFixture.runtimeconfig.json",
        "Temporalio.Extensions.Hosting.dll",
        "NexusRpc.dll",
      ].map((name) =>
        expect.objectContaining({
          path: posix.join(posix.dirname(assembly), name),
          kind: "native-output",
        }),
      ),
    ]),
  });
  return command;
}

test(".NET inspection preserves native source boundaries, identities, and unresolved diagnostics", async () => {
  await withFixture([["dotnet", "--version"]], async (fixture) => {
    const app = join(fixture.project, packagePath);
    await cp(source, app, { recursive: true });
    const projectFile = join(app, "Worker.csproj");
    const project = await readFile(projectFile, "utf8");
    await writeFile(
      projectFile,
      project.replace(
        "</Project>",
        `
      <Target Name="Canary" BeforeTargets="Build">
        <WriteLinesToFile File="$(GENESYS_DOTNET_MSBUILD_MARKER)" Lines="build hook executed" />
      </Target>
    </Project>`,
      ),
    );
    const inspectionMarker = join(fixture.root, "authored-code-ran");
    const buildMarker = join(fixture.root, "build-ran");
    const ignored = "using Temporalio.Workflows; [Workflow] public class Ignored {}\n";
    await mkdir(join(app, "temporal/workflows/lib"));
    await writeFile(join(app, "temporal/workflows/lib/Ignored.cs"), ignored);
    await writeFile(
      join(app, "temporal/workflows/IgnoredTests.cs"),
      ignored.replace("Ignored", "NativeTest"),
    );

    const inspected = await fixture.gsys(["inspect"], {
      env: {
        GENESYS_DOTNET_INSPECTION_MARKER: inspectionMarker,
        GENESYS_DOTNET_MSBUILD_MARKER: buildMarker,
      },
    });
    expect(inspected.code).toBe(0);
    const a: unknown = JSON.parse(inspected.stdout);
    expect(a).toMatchObject({
      analysis: "native-analysis",
      packages: [
        { language: "dotnet", root: packagePath, manifests: [`${packagePath}/Worker.csproj`] },
      ],
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: `${packagePath}/${oldJob}`,
          discoveryRoot: `${packagePath}/features/temporal`,
        }),
        expect.objectContaining({
          path: `${packagePath}/${workerFile}`,
          discoveryRoot: `${packagePath}/temporal`,
        }),
      ]),
      workers: [{ name: "dotnet", source: { path: `${packagePath}/${workerFile}` } }],
      definitions: expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          entryId: `${packagePath}/temporal/workflows/Jobs.cs`,
          identity: { state: "resolved", name: "dotnet-greeting" },
        }),
        expect.objectContaining({
          kind: "workflow",
          entryId: `${packagePath}/temporal/workflows/Jobs.cs`,
          identity: { state: "resolved", name: "AuthoredJob" },
        }),
        expect.objectContaining({
          kind: "workflow",
          identity: { state: "resolved", name: "RetiredJob" },
        }),
        expect.objectContaining({
          kind: "activity",
          identity: { state: "resolved", name: "decorate" },
          construction: expect.objectContaining({ symbol: "DotnetFixture.Definitions.Formatter" }),
        }),
        expect.objectContaining({
          kind: "activity",
          identity: { state: "resolved", name: "Finish" },
        }),
        expect.objectContaining({
          kind: "activity",
          identity: { state: "resolved", name: "Tag" },
          source: expect.objectContaining({
            path: `${packagePath}/temporal/activities/formatting/Formatter.More.cs`,
          }),
        }),
        expect.objectContaining({
          kind: "nexus",
          identity: { state: "resolved", name: "FixtureGreeter" },
        }),
      ]),
    });
    if (!record(a) || !Array.isArray(a.definitions) || !Array.isArray(a.entries))
      throw new Error("Inspection is missing discovery entries or definitions");
    expect(a.definitions).toHaveLength(7);
    expect(a.entries).toHaveLength(6);
    expect(inspected.stderr).toContain("dotnet.explicit-workflow-factory");
    await expect(readFile(inspectionMarker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(buildMarker)).rejects.toMatchObject({ code: "ENOENT" });

    const relocated = "features/temporal/workflows/Relocated.cs";
    await rename(join(app, oldJob), join(app, relocated));
    const moved = await fixture.gsys(["inspect"]);
    expect(moved.code).toBe(0);
    const afterMove: unknown = JSON.parse(moved.stdout);
    expect(afterMove).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          source: expect.objectContaining({ path: `${packagePath}/${relocated}` }),
          identity: { state: "resolved", name: "RetiredJob" },
        }),
      ]),
    });

    await writeFile(
      projectFile,
      project.replace("<OutputType>", `<OutputType Condition="'1' == '1'">`),
    );
    const unresolved = await fixture.gsys(["build"]);
    expect(unresolved.code).toBe(1);
    expect(unresolved.stderr).toContain("dotnet.project-evaluation-required");
    expect(unresolved.stderr).toContain("explicit native assembly remains valid");
    const unresolvedOutput: unknown = JSON.parse(unresolved.stdout);
    expect(unresolvedOutput).toMatchObject({ workers: [] });
    await expect(readFile(join(fixture.project, selectedManifest))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await writeFile(projectFile, project);

    const invalidSource = join(app, "temporal/activities/Invalid.cs");
    await writeFile(
      invalidSource,
      `
      using Temporalio.Activities;
      public static class Invalid {
        public static Func<string> MissingName = [Activity] () => "invalid";
      }
    `,
    );
    const invalid = await fixture.gsys(["inspect"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("dotnet.lambda-name-required");
    expect(invalid.stderr).toContain("native SDK requires an explicit Activity name");
    expect(invalid.stderr).not.toContain("dotnet.project-evaluation-required");
    await rm(invalidSource);

    const alternative = "temporal/workers/another/Another.cs";
    await mkdir(join(app, "temporal/workers/another"));
    await writeFile(join(app, alternative), "internal class Another {}\n");
    const ambiguous = await fixture.gsys(["inspect"]);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("dotnet.entrypoint-name-ambiguous");
    const ambiguousOutput: unknown = JSON.parse(ambiguous.stdout);
    expect(ambiguousOutput).toMatchObject({
      workers: [],
      entries: expect.arrayContaining([
        expect.objectContaining({ path: `${packagePath}/${workerFile}`, workerName: "dotnet" }),
        expect.objectContaining({ path: `${packagePath}/${alternative}`, workerName: "another" }),
      ]),
    });
  });
}, 360_000);

test(".NET scope analysis accepts separate native Activity instances and blocks an aggregate collision", async () => {
  await withFixture([["dotnet", "--version"]], async (fixture) => {
    const activities = join(fixture.project, "temporal/activities");
    await mkdir(activities, { recursive: true });
    await writeFile(
      join(fixture.project, "Scopes.csproj"),
      `
      <Project Sdk="Microsoft.NET.Sdk">
        <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup>
        <ItemGroup><PackageReference Include="Temporalio" Version="1.22.0" /></ItemGroup>
      </Project>
    `,
    );
    for (const type of ["Left", "Right"]) {
      await writeFile(
        join(activities, `${type}.cs`),
        `
        using Temporalio.Activities;
        public class ${type} {
          [Activity("shared-name")] public string Work() => "${type}";
        }
      `,
      );
    }
    await writeFile(
      join(fixture.project, "Program.cs"),
      `
      using System;
      using System.Linq;
      using Genesys.Generated;
      using Temporalio.Worker;
      var left = new TemporalWorkerOptions("left").AddGenesysActivities(new Left());
      var right = new TemporalWorkerOptions("right").AddGenesysActivities(new Right());
      Console.WriteLine($"{left.Activities.Single().Name},{right.Activities.Single().Name}");
    `,
    );
    const separate = await fixture.gsys(["build"]);
    expect(separate.code).toBe(0);
    expect(separate.stderr).toContain("warning dotnet.generated-registration-collision");
    expect(separate.stderr).toContain("Left.Work()");
    expect(separate.stderr).toContain("Right.Work()");
    const selected = join(fixture.project, selectedManifest);
    const good = await readFile(selected, "utf8");
    const publication: unknown = JSON.parse(good);
    expect(publication).toMatchObject({
      workers: [{ name: "Scopes", language: "dotnet" }],
      artifacts: expect.arrayContaining([
        { kind: "registration", path: "GenesysRegistration.g.cs", entry: expect.any(Object) },
      ]),
    });
    const command = workerCommand(publication);
    const scoped = await fixture.run(command.executable, command.args, {
      cwd: command.cwd,
      env: command.env,
    });
    expect(scoped).toMatchObject({
      code: 0,
      stdout: expect.stringMatching(/^shared-name,shared-name\r?\n$/),
    });

    for (const type of ["Left", "Right"]) {
      const file = join(activities, `${type}.cs`);
      await writeFile(
        file,
        (await readFile(file, "utf8")).replace("public string", "public static string"),
      );
    }
    await writeFile(
      join(fixture.project, "Program.cs"),
      `
      using Genesys.Generated;
      using Temporalio.Worker;
      new TemporalWorkerOptions("combined").AddGenesysStaticActivities();
    `,
    );
    const combined = await fixture.gsys(["build"]);
    expect(combined.code).toBe(1);
    expect(combined.stderr).toContain("error dotnet.generated-registration-collision");
    expect(combined.stderr).toContain("shared-name");
    expect(combined.stderr).toContain("Left.Work()");
    expect(combined.stderr).toContain("Right.Work()");
    expect(await readFile(selected, "utf8")).toBe(good);
  });
}, 360_000);

test(".NET generated raw and Hosting registration execute from published Worker commands and follow source changes", async () => {
  await withFixture(
    [
      ["dotnet", "--version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      const app = join(fixture.project, packagePath);
      await cp(source, app, { recursive: true });
      const authored = await readFile(join(app, workerFile), "utf8");
      const first = await fixture.gsys(["build"], { timeout: 180_000 });
      expect(first.code).toBe(0);
      const initial = await publishedWorker(fixture.project);
      const oldRegistration = await readFile(join(initial.root, generated), "utf8");
      expect(oldRegistration).toContain("DotnetFixture.RetiredJob");
      expect(oldRegistration).not.toContain("DotnetFixture.AuthoredJob");

      const endpoint = await temporalEndpoint();
      const server = fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
      const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "10s" });
      try {
        await connection.ensureConnected();
        await expect
          .poll(
            () =>
              connection.withDeadline(Date.now() + 5_000, () =>
                connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
              ),
            { timeout: 10_000 },
          )
          .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });

        async function probe(
          command: Awaited<ReturnType<typeof publishedWorker>>,
          mode: "raw" | "hosted",
          generation: "RetiredJob" | "NewJob",
          label: "supplied-instance" | "hosting-dependency",
          version: "retired" | "added",
        ) {
          const options = {
            cwd: command.cwd,
            env: { ...command.env, ...endpoint.workerEnv, GENESYS_DOTNET_MODE: mode },
          };
          const worker = fixture.start(command.executable, command.args, options);
          try {
            const result = await fixture.run(
              command.executable,
              [...command.args, "probe", generation],
              {
                ...options,
                timeout: 80_000,
              },
            );
            expect(result.code).toBe(0);
            const output: unknown = JSON.parse(result.stdout);
            expect(output).toEqual({
              workflow: [
                `intercepted:${label}:Genesys:private:partial`,
                `${label}:nexus:Genesys`,
                "rejected by fixture",
              ],
              authored: "authored-factory",
              version,
            });
          } finally {
            worker.signal("SIGINT");
            expect(await worker.wait(20_000)).toMatchObject({ code: 0 });
          }
        }

        await probe(initial, "raw", "RetiredJob", "supplied-instance", "retired");
        await probe(initial, "hosted", "RetiredJob", "hosting-dependency", "retired");
        const oldSource = await readFile(join(app, oldJob), "utf8");
        await rm(join(app, oldJob));
        const newSource = oldSource.replace("RetiredJob", "NewJob").replace('"retired"', '"added"');
        await writeFile(join(app, newJob), newSource);

        const rebuilt = await fixture.gsys(["build"], { timeout: 180_000 });
        expect(rebuilt.code).toBe(0);
        const next = await publishedWorker(fixture.project);
        expect(next.root).not.toBe(initial.root);
        expect(await readFile(join(app, workerFile), "utf8")).toBe(authored);
        expect(await readFile(join(app, newJob), "utf8")).toBe(newSource);
        await expect(readFile(join(fixture.project, generated))).rejects.toMatchObject({
          code: "ENOENT",
        });
        const newRegistration = await readFile(join(next.root, generated), "utf8");
        expect(newRegistration).not.toContain("DotnetFixture.RetiredJob");
        expect(newRegistration).toContain("DotnetFixture.NewJob");
        await probe(next, "raw", "NewJob", "supplied-instance", "added");
      } finally {
        await connection.close();
        await server.stop();
      }
    },
  );
}, 720_000);
