import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const selector = ".gsys/compile/manifest.json";
const greeting = "temporal/activities/greeting.go";
const dependency = "dependency/value.go";
const workflowRegistration = "temporal/workflows/zz_genesys_registration.go";
const workersSource = "temporal/workers/manifest/main.js";

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function publish(
  fixture: Fixture,
  { project = fixture.project, env }: { project?: string; env?: NodeJS.ProcessEnv } = {},
) {
  expect((await fixture.gsys(["build"], { cwd: project, env })).code).toBe(0);
  const current = await readFile(join(project, selector), "utf8");
  const selected: unknown = JSON.parse(current);
  assert(selected && typeof selected === "object");
  assert("root" in selected && typeof selected.root === "string");
  assert("manifestPath" in selected && typeof selected.manifestPath === "string");
  assert("metadataPath" in selected && typeof selected.metadataPath === "string");
  expect(isAbsolute(selected.root)).toBe(true);
  expect(selected.manifestPath).toBe(join(dirname(selected.root), "manifest.json"));
  expect(selected.metadataPath).toBe(join(dirname(selected.root), "metadata.json"));
  await expect(readFile(selected.manifestPath, "utf8")).resolves.toBe(current);
  const metadata = await readFile(selected.metadataPath, "utf8");
  return { selected, root: selected.root, current, metadata };
}

async function fileEntry(root: string, path: string) {
  const file = await readFile(join(root, path));
  return {
    path,
    kind: "file",
    size: file.length,
    sha256: createHash("sha256").update(file).digest("hex"),
  };
}

test("Go builds retain their own source, local modules, and registration across updates", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      const { project } = fixture;
      for (const path of ["go.mod", "go.sum", "temporal"])
        await cp(join(example, path), join(project, path), { recursive: true });
      const manifest = await readFile(join(project, "go.mod"), "utf8");
      const goMod = `${manifest}
require (
  example.com/isolation-dependency v0.0.0
  example.com/isolation-settings v0.0.0
)
replace example.com/isolation-dependency => ./dependency-link
replace example.com/isolation-settings => ./settings/first
`;
      for (const { path, module, value } of [
        { path: "dependency", module: "isolation-dependency", value: "dependency-first" },
        { path: "settings/first", module: "isolation-settings", value: "settings-first" },
        { path: "settings/second", module: "isolation-settings", value: "settings-second" },
      ]) {
        await mkdir(join(project, path), { recursive: true });
        await writeFile(
          join(project, path, "go.mod"),
          `module example.com/${module}\n\ngo 1.26.0\n`,
        );
        await writeFile(
          join(project, path, "value.go"),
          `package local\nconst Value = "${value}"\n`,
        );
      }
      await symlink(join(project, "dependency"), join(project, "dependency-link"), "dir");
      const activity = `package activities
import (
  "context"
  dependency "example.com/isolation-dependency"
  settings "example.com/isolation-settings"
)
func Greet(_ context.Context, name string) (string, error) {
  return "source-first/" + dependency.Value + "/" + settings.Value + "/" + name, nil
}
`;
      const legacy = "temporal/workflows/legacy.go";
      await writeFile(join(project, "go.mod"), goMod);
      await writeFile(join(project, greeting), activity);
      const legacySource = `package workflows
import "go.temporal.io/sdk/workflow"
func Legacy(_ workflow.Context) (string, error) { return "legacy", nil }
`;
      await writeFile(join(project, legacy), legacySource);

      const equivalent = join(fixture.root, "equivalent", "nested-project");
      await cp(project, equivalent, {
        recursive: true,
        filter: (path) => path !== join(project, "dependency-link"),
      });
      await symlink(join(equivalent, "dependency"), join(equivalent, "dependency-link"), "dir");
      const first = await publish(fixture);
      const repeated = await publish(fixture, { project: equivalent });
      const registrations = [
        "temporal/activities/zz_genesys_registration.go",
        "temporal/gsysregistration/registration.go",
        workflowRegistration,
      ];
      const generated = [];
      for (const path of registrations) {
        const { sha256 } = await fileEntry(first.root, path);
        generated.push({ path, sha256, kind: "registration" });
        await expect(readFile(join(repeated.root, path), "utf8")).resolves.toBe(
          await readFile(join(first.root, path), "utf8"),
        );
      }
      for (const build of [first, repeated]) {
        const metadata: unknown = JSON.parse(build.metadata);
        assert(metadata && typeof metadata === "object" && "generation" in metadata);
        expect(metadata.generation).toHaveLength(generated.length);
        expect(metadata.generation).toEqual(expect.arrayContaining(generated));
        expect(metadata).toMatchObject({
          inputs: expect.arrayContaining([
            { path: "dependency-link", kind: "symlink", target: "dependency" },
          ]),
        });
        await expect(readlink(join(build.root, "dependency-link"))).resolves.toBe("dependency");
      }

      // Copy back real stale registration before withdrawing one authored definition.
      const stale = "temporal/workflows/stale_registration.go";
      await cp(join(first.root, workflowRegistration), join(project, stale));
      await rm(join(project, legacy));
      await writeFile(
        join(project, "temporal/workflows/current.go"),
        legacySource.replace("Legacy", "Current").replace('"legacy"', '"current"'),
      );
      await writeFile(
        join(project, "go.mod"),
        goMod.replace("./settings/first", "./settings/second"),
      );
      await writeFile(join(project, greeting), activity.replace("source-first", "source-second"));
      await writeFile(
        join(project, dependency),
        'package local\nconst Value = "dependency-second"\n',
      );
      const second = await publish(fixture);
      expect(first.root).not.toBe(second.root);
      for (const path of ["go.mod", greeting, dependency]) {
        const before = await fileEntry(first.root, path);
        const after = await fileEntry(second.root, path);
        expect(before.sha256).not.toBe(after.sha256);
        expect(JSON.parse(first.metadata)).toMatchObject({
          inputs: expect.arrayContaining([expect.objectContaining(before)]),
        });
        expect(JSON.parse(second.metadata)).toMatchObject({
          inputs: expect.arrayContaining([expect.objectContaining(after)]),
        });
      }
      const oldRegistration = await readFile(join(first.root, workflowRegistration), "utf8");
      expect(oldRegistration).toContain("Legacy");
      await expect(readFile(join(project, stale), "utf8")).resolves.toBe(oldRegistration);
      await expect(readFile(join(second.root, stale))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(second.root, workflowRegistration), "utf8"),
      ).resolves.not.toContain("Legacy");

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
            { timeout: 10_000 },
          )
          .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
        const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
        for (const { build, greetingResult, versionWorkflow, versionResult } of [
          {
            build: first,
            greetingResult: "source-first/dependency-first/settings-first/Genesys",
            versionWorkflow: "Legacy",
            versionResult: "legacy",
          },
          {
            build: second,
            greetingResult: "source-second/dependency-second/settings-second/Genesys",
            versionWorkflow: "Current",
            versionResult: "current",
          },
        ]) {
          assert("workers" in build.selected && Array.isArray(build.selected.workers));
          expect(build.selected.workers).toHaveLength(1);
          const worker: unknown = build.selected.workers[0];
          assert(worker && typeof worker === "object" && "start" in worker);
          const { start } = worker;
          assert(
            start &&
              typeof start === "object" &&
              "executable" in start &&
              "args" in start &&
              "cwd" in start,
          );
          assert(typeof start.executable === "string" && typeof start.cwd === "string");
          assert(
            Array.isArray(start.args) &&
              start.args.every((arg: unknown) => typeof arg === "string"),
          );
          expect(start.cwd).toBe(build.root);
          expect(isAbsolute(start.executable)).toBe(true);
          expect(relative(build.root, start.executable)).toMatch(/^\.gsys[\\/]native[\\/]/);
          const workerProcess = fixture.start(start.executable, start.args, {
            cwd: start.cwd,
            env: endpoint.workerEnv,
          });
          for (const { name, args, expected } of [
            { name: "Greeting", args: ["Genesys"], expected: greetingResult },
            { name: versionWorkflow, args: [], expected: versionResult },
          ]) {
            const workflow = await connection.withDeadline(Date.now() + 45_000, () =>
              client.start(name, {
                taskQueue: "greetings",
                workflowId: randomUUID(),
                args,
                workflowExecutionTimeout: "40s",
              }),
            );
            await expect(
              connection.withDeadline(Date.now() + 45_000, () => workflow.result()),
            ).resolves.toBe(expected);
          }
          workerProcess.signal("SIGINT");
          expect((await workerProcess.wait(45_000)).code).toBe(0);
        }
      } finally {
        await connection.close();
      }
    },
  );
}, 720_000);

test("publication records native removals and generated files and rejects links across builds", async () => {
  await withFixture([], async (fixture) => {
    const { project } = fixture;
    await mkdir(join(project, dirname(workersSource)), { recursive: true });
    await mkdir(join(project, "temporal/workflows"), { recursive: true });
    await mkdir(join(project, "node_modules/typescript/bin"), { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        type: "module",
        main: workersSource,
      }),
    );
    await writeFile(
      join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { allowJs: true, module: "NodeNext", rootDir: ".", outDir: "dist" },
        include: ["temporal/**/*"],
      }),
    );
    await writeFile(join(project, workersSource), "export {};\n");
    await writeFile(
      join(project, "temporal/workflows/echo.js"),
      "export async function Echo(value) { return value; }\n",
    );
    await writeFile(join(project, "removable.txt"), "authored input\n");
    await writeFile(
      join(project, "node_modules/typescript/bin/tsc"),
      `const { cpSync, copyFileSync, rmSync, symlinkSync } = require("node:fs");
cpSync("temporal", "dist/temporal", { recursive: true });
copyFileSync("removable.txt", "dist/receipt.txt");
rmSync("removable.txt");
if (process.env.GENESYS_TEST_NATIVE_OUTPUT_TARGET) {
  symlinkSync(process.env.GENESYS_TEST_NATIVE_OUTPUT_TARGET, "dist/output-link");
}
`,
    );

    const secret = randomUUID();
    const first = await publish(fixture, { env: { GENESYS_TEST_SECRET: secret } });
    const registration = "temporal/genesys-workflows.ts";
    const output = "dist/receipt.txt";
    await expect(readFile(join(first.root, registration), "utf8")).resolves.toContain(
      'export { "Echo" as "Echo" } from "./workflows/echo.js";',
    );
    await expect(readFile(join(first.root, "removable.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(first.root, output), "utf8")).resolves.toBe("authored input\n");
    expect(first.selected).toMatchObject({
      artifacts: expect.arrayContaining([
        {
          path: registration,
          kind: "registration",
          entry: expect.objectContaining(await fileEntry(first.root, registration)),
        },
        {
          path: output,
          kind: "native-output",
          entry: expect.objectContaining(await fileEntry(first.root, output)),
        },
      ]),
    });
    const metadata: unknown = JSON.parse(first.metadata);
    expect(metadata).toMatchObject({
      inputs: expect.arrayContaining([
        expect.objectContaining(await fileEntry(project, "removable.txt")),
      ]),
      generation: expect.arrayContaining([
        {
          path: registration,
          kind: "registration",
          sha256: (await fileEntry(first.root, registration)).sha256,
        },
      ]),
      removedInputs: ["removable.txt"],
      commands: [
        {
          executable: "node",
          cwd: first.root,
          args: ["node_modules/typescript/bin/tsc", "--build", "--force", "tsconfig.json"],
        },
      ],
      environmentSha256: expect.stringMatching(/^[a-f\d]{64}$/),
    });
    expect((first.current + first.metadata).includes(secret)).toBe(false);

    const outside = join(fixture.root, "outside.txt");
    await writeFile(outside, "outside source\n");
    const link = join(project, "bad-input-link");
    for (const target of [outside, join(first.root, output)]) {
      await symlink(target, link);
      const failed = await fixture.gsys(["build"]);
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain("Cannot isolate symbolic link bad-input-link");
      await rm(link);
    }
    for (const target of [join(project, "removable.txt"), join(first.root, output)]) {
      const failed = await fixture.gsys(["build"], {
        env: { GENESYS_TEST_NATIVE_OUTPUT_TARGET: target },
      });
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain(
        "Native build linked mutable authored source: dist/output-link",
      );
    }
    await expect(readFile(join(project, selector), "utf8")).resolves.toBe(first.current);
    await expect(readdir(join(project, ".gsys/compile/builds"))).resolves.toHaveLength(1);
    await expect(readFile(join(first.root, output), "utf8")).resolves.toBe("authored input\n");
    await expect(readFile(join(project, "removable.txt"), "utf8")).resolves.toBe(
      "authored input\n",
    );
    await expect(readFile(join(project, registration))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(project, output))).rejects.toMatchObject({ code: "ENOENT" });
  });
}, 720_000);
