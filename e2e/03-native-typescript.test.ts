import { Connection, WorkflowClient } from "@temporalio/client";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { access, cp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const app = fileURLToPath(new URL("./fixtures/typescript-native/app/", import.meta.url));
const packageRoot = "apps/typescript";
const taskQueue = "ts-native";
type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function install(fixture: Fixture) {
  const cwd = join(fixture.project, packageRoot);
  await cp(app, cwd, {
    recursive: true,
    filter: (source) => !["node_modules", "dist", ".gsys"].includes(basename(source)),
  });
  const result = await fixture.run("npm", ["ci", "--no-audit", "--no-fund"], { cwd });
  expect(result).toMatchObject({ code: 0 });
  return cwd;
}

test("TypeScript inspection keeps native export identities and never executes application code", async () => {
  await withFixture([], async (fixture) => {
    const cwd = await install(fixture);
    const marker = join(fixture.root, "executed");
    const options = { env: { GENESYS_TS_MARKER: marker } };
    const inspected = await fixture.gsys(["inspect"], options);
    expect(inspected.code).toBe(0);
    expect(inspected.stderr).toContain("Declared @temporalio/worker: 1.25.0; installed: 1.25.0");
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });

    const discovery: unknown = JSON.parse(inspected.stdout);
    expect(discovery).toMatchObject({
      analysis: "native-analysis",
      packages: [expect.objectContaining({ language: "typescript", root: packageRoot })],
      entries: expect.arrayContaining([
        expect.objectContaining({
          path: `${packageRoot}/temporal/orders/workflows/checkout.mts`,
          role: "workflow",
          discoveryRoot: `${packageRoot}/temporal`,
        }),
        expect.objectContaining({ path: `${packageRoot}/temporal/workflows/aliases.mts` }),
        expect.objectContaining({
          path: `${packageRoot}/temporal/activities/legacy.cjs`,
          role: "activity",
        }),
      ]),
      definitions: expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          identity: { name: "Checkout", state: "resolved" },
        }),
        expect.objectContaining({
          kind: "workflow",
          identity: { name: "NexusProbe", state: "resolved" },
        }),
        expect.objectContaining({
          kind: "workflow",
          symbol: "default",
          identity: expect.objectContaining({ state: "dynamic" }),
        }),
        expect.objectContaining({
          kind: "activity",
          identity: { name: "legacy", state: "resolved" },
        }),
        expect.objectContaining({
          kind: "activity",
          identity: { name: "stamp", state: "resolved" },
          construction: expect.objectContaining({ symbol: "activityMap" }),
        }),
        expect.objectContaining({
          kind: "nexus",
          identity: { name: "TypeScriptInventory", state: "resolved" },
        }),
      ]),
      workers: [
        expect.objectContaining({
          name: "orders",
          build: [{ executable: "npm", args: ["run", "build"], cwd: packageRoot }],
          start: { executable: "node", args: ["dist/workers/orders/index.js"], cwd: packageRoot },
        }),
      ],
    });
    for (const name of [
      "approve",
      "validateOrder",
      "orderName",
      "TestHelper",
      "checkout",
      "default",
    ]) {
      expect(discovery).toMatchObject({
        definitions: expect.not.arrayContaining([
          expect.objectContaining({ identity: expect.objectContaining({ name }) }),
        ]),
      });
    }

    await rename(
      join(cwd, "temporal/orders/workflows/checkout.mts"),
      join(cwd, "temporal/orders/workflows/moved.mts"),
    );
    await writeFile(
      join(cwd, "temporal/workflows/aliases.mts"),
      'export { Checkout } from "../orders/workflows/moved.mjs";\n',
    );
    const moved = await fixture.gsys(["inspect"], options);
    expect(moved.code).toBe(0);
    const renamed: unknown = JSON.parse(moved.stdout);
    expect(renamed).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          identity: { name: "Checkout", state: "resolved" },
          source: expect.objectContaining({
            path: `${packageRoot}/temporal/orders/workflows/moved.mts`,
          }),
        }),
      ]),
    });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
}, 360_000);

test("TypeScript inspection confines collisions to one Worker scope and reports unresolved startup", async () => {
  await withFixture([], async (fixture) => {
    const cwd = await install(fixture);
    const probe = join(cwd, "workers/orders/scopes.ts");
    const scopes = `
      import { Worker } from "@temporalio/worker";
      import { inventoryHandler } from "../../temporal/nexus/inventory.js";
      export async function independent(dynamicName: string) {
        const first = async () => "first";
        const second = async () => "second";
        await Worker.create({
          taskQueue: "first",
          activities: { repeat: first },
          nexusServices: [inventoryHandler],
        });
        await Worker.create({
          taskQueue: "second",
          activities: { repeat: second, [dynamicName]: first },
          nexusServices: [inventoryHandler],
        });
      }
    `;
    await writeFile(probe, scopes);
    await writeFile(
      join(cwd, "workers/orders/alternate.ts"),
      'await Promise.resolve("alternate");\n',
    );
    const unresolved = await fixture.gsys(["inspect"]);
    expect(unresolved.code).toBe(0);
    expect(unresolved.stderr).toMatch(
      /warning typescript\.native-assembly-unresolved.*unknown keys/,
    );
    expect(unresolved.stderr).toMatch(
      /warning typescript\.worker-entrypoint-ambiguous.*2 executable candidates/,
    );
    const discovery: unknown = JSON.parse(unresolved.stdout);
    expect(discovery).toMatchObject({
      definitions: expect.arrayContaining(
        ["first", "second"].map((symbol) =>
          expect.objectContaining({
            kind: "activity",
            symbol,
            identity: { name: "repeat", state: "resolved" },
            registrationScope: expect.stringContaining("workers/orders/scopes.ts:"),
          }),
        ),
      ),
      workers: [expect.not.objectContaining({ start: expect.anything() })],
    });
    const diagnostics: unknown = JSON.parse(
      await readFile(join(fixture.project, ".gsys/discovery/diagnostics.json"), "utf8"),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "typescript.worker-entrypoint-ambiguous",
          related: expect.arrayContaining([
            { path: `${packageRoot}/workers/orders/index.ts` },
            { path: `${packageRoot}/workers/orders/alternate.ts` },
          ]),
        }),
      ]),
    );

    await writeFile(
      probe,
      scopes.replace("[inventoryHandler]", "[inventoryHandler, inventoryHandler]"),
    );
    await writeFile(
      join(cwd, "temporal/workflows/unsafe.mts"),
      'import { activityMap } from "../activities/order.js";\nexport async function Unsafe() { return activityMap.stamp("unsafe"); }\n',
    );
    const invalid = await fixture.gsys(["inspect"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toMatch(
      /error typescript\.native-registration-collision.*TypeScriptInventory/,
    );
    expect(invalid.stderr).toMatch(
      /error typescript\.workflow-runtime-import.*workflows\/unsafe\.mts/,
    );
  });
}, 360_000);

async function buildWorker(fixture: Fixture, buildEnv: NodeJS.ProcessEnv) {
  const built = await fixture.gsys(["build"], { env: buildEnv });
  expect(built).toMatchObject({ code: 0 });
  const published: unknown = JSON.parse(
    await readFile(join(fixture.project, ".gsys/compile/manifest.json"), "utf8"),
  );
  assert(
    published &&
      typeof published === "object" &&
      "root" in published &&
      typeof published.root === "string",
  );
  assert("id" in published && typeof published.id === "string");
  assert("manifestPath" in published && typeof published.manifestPath === "string");
  const manifest: unknown = JSON.parse(await readFile(published.manifestPath, "utf8"));
  expect(manifest).toEqual(published);
  expect(published.root).toBe(
    join(await realpath(fixture.project), ".gsys", "compile", "builds", published.id, "project"),
  );
  expect(published).toMatchObject({
    workers: [expect.objectContaining({ name: "orders" })],
    artifacts: expect.arrayContaining(
      [
        ["temporal/genesys-workflows.mts", "registration"],
        ["temporal/genesys-activities.ts", "registration"],
        ["temporal/genesys-nexus.ts", "registration"],
        ["dist/temporal/genesys-workflows.mjs", "native-output"],
        ["dist/temporal/activities/legacy.cjs", "native-output"],
        ["dist/workers/orders/lib/options.js", "native-output"],
      ].map(([path, kind]) => expect.objectContaining({ path: `${packageRoot}/${path}`, kind })),
    ),
  });

  assert("workers" in published && Array.isArray(published.workers));
  const worker: unknown = published.workers[0];
  assert(worker && typeof worker === "object" && "start" in worker);
  const { start } = worker;
  assert(
    start &&
      typeof start === "object" &&
      "executable" in start &&
      typeof start.executable === "string",
  );
  assert("cwd" in start && typeof start.cwd === "string");
  assert(
    "args" in start &&
      Array.isArray(start.args) &&
      start.args.every((arg: unknown) => typeof arg === "string"),
  );
  const env: NodeJS.ProcessEnv = {};
  if ("env" in start && start.env !== undefined) {
    assert(start.env && typeof start.env === "object" && !Array.isArray(start.env));
    for (const [key, value] of Object.entries(start.env)) {
      assert(typeof value === "string");
      env[key] = value;
    }
  }
  expect(start.cwd).toBe(join(published.root, packageRoot));
  expect(start.args).toEqual(["dist/workers/orders/index.js"]);
  return {
    id: published.id,
    executable: start.executable,
    cwd: start.cwd,
    args: start.args,
    env,
  };
}

test("the installed TypeScript build preserves native assembly, handlers, Nexus services, options and regeneration", async () => {
  await withFixture([["temporal", "--version"]], async (fixture) => {
    const cwd = await install(fixture);
    const marker = join(fixture.root, "executed");
    const options = { GENESYS_TS_MARKER: marker };
    const first = await buildWorker(fixture, options);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });

    const generatedWorkflows = "temporal/genesys-workflows.mts";
    const firstWorkflows = await readFile(join(first.cwd, generatedWorkflows), "utf8");
    await expect(access(join(cwd, generatedWorkflows))).rejects.toMatchObject({ code: "ENOENT" });

    const endpoint = await temporalEndpoint();
    fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
    const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
    try {
      await connection.ensureConnected();
      const call = <T>(action: () => Promise<T>) =>
        connection.withDeadline(Date.now() + 20_000, action);
      await expect
        .poll(
          () =>
            call(() =>
              connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
            ),
          {
            timeout: 10_000,
          },
        )
        .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
      await call(() =>
        connection.operatorService.createNexusEndpoint({
          spec: {
            name: "ts-inventory",
            target: { worker: { namespace: endpoint.namespace, taskQueue } },
          },
        }),
      );
      const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
      const start = (name: string, ...args: unknown[]) =>
        call(() =>
          client.start(name, {
            args,
            taskQueue,
            workflowId: randomUUID(),
            workflowExecutionTimeout: "30s",
          }),
        );
      const execute = async (name: string, ...args: unknown[]) => {
        const workflow = await start(name, ...args);
        return call(() => workflow.result());
      };
      const launch = (build: Awaited<ReturnType<typeof buildWorker>>) =>
        fixture.start(build.executable, build.args, {
          cwd: build.cwd,
          env: { ...endpoint.workerEnv, ...options, ...build.env },
        });

      // A cwd or dependency taken from authored source would use the wrong queue.
      await writeFile(join(cwd, "task-queue.txt"), "mutated\n");
      const firstWorker = launch(first);
      const checkout = await start("Checkout");
      await expect(
        call(() => checkout.executeUpdate("approve", { args: [" "] })),
      ).rejects.toMatchObject({
        cause: { message: "An order name is required" },
      });
      await expect(
        call(() => checkout.executeUpdate("approve", { args: [" beans "] })),
      ).resolves.toBe("BEANS");
      await expect(call(() => checkout.result())).resolves.toEqual([
        "intercepted:orders:BEANS",
        "intercepted:commonjs:BEANS",
        "intercepted:authored:BEANS",
      ]);
      await expect(execute("PreviousOrder")).resolves.toBe("previous");
      await expect(execute("NexusProbe", "lookup", "beans")).resolves.toBe("east:beans");
      await expect(execute("NexusProbe", "reserve", "beans")).rejects.toMatchObject({
        cause: {
          service: "TypeScriptInventory",
          operation: "reserve",
          cause: { message: "east is out of beans" },
        },
      });
      expect(await readFile(marker, "utf8")).toBe("activity import\nactivity constructor\n");
      await firstWorker.stop();

      await writeFile(join(cwd, "task-queue.txt"), `${taskQueue}\n`);
      await rm(join(cwd, "temporal/workflows/old.mts"));
      await writeFile(
        join(cwd, "temporal/workflows/added.mts"),
        'export async function CurrentOrder() { return "current"; }\n',
      );
      const second = await buildWorker(fixture, options);
      expect(second.id).not.toBe(first.id);
      expect(await readFile(join(first.cwd, generatedWorkflows), "utf8")).toBe(firstWorkflows);

      const secondWorker = launch(second);
      await expect(execute("CurrentOrder")).resolves.toBe("current");
      await expect(execute("PreviousOrder")).resolves.toBe("fallback:PreviousOrder");
      await secondWorker.stop();
    } finally {
      await connection.close();
    }
  });
}, 720_000);
