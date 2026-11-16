import assert from "node:assert/strict";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/go-registration/", import.meta.url));
const workerSource = "temporal/workers/orders/main.go";
const workflows = "temporal/workflows";
const symbol = "example.com/go-registration/temporal";
const isolatedConfig = ["--disable-config-env", "--disable-config-file"];

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function buildWorker(fixture: Fixture) {
  const result = await fixture.gsys(["build"]);
  expect(result.code).toBe(0);
  const published: unknown = JSON.parse(result.stdout);
  expect(published).toMatchObject({
    inputs: expect.arrayContaining([expect.objectContaining({ path: "support/support.go" })]),
  });
  assert(published && typeof published === "object" && "manifestPath" in published);
  assert(typeof published.manifestPath === "string");
  const manifest: unknown = JSON.parse(await readFile(published.manifestPath, "utf8"));
  assert(manifest && typeof manifest === "object" && "root" in manifest && "workers" in manifest);
  assert(typeof manifest.root === "string" && Array.isArray(manifest.workers));
  expect(manifest.workers).toHaveLength(1);
  const worker: unknown = manifest.workers[0];
  assert(worker && typeof worker === "object" && "start" in worker);
  expect(worker).toMatchObject({ name: "orders", source: { path: workerSource } });
  const { start } = worker;
  assert(
    start &&
      typeof start === "object" &&
      "executable" in start &&
      "args" in start &&
      "cwd" in start,
  );
  assert(typeof start.executable === "string" && isAbsolute(start.executable));
  assert(Array.isArray(start.args) && start.args.every((arg: unknown) => typeof arg === "string"));
  const nativePath = relative(manifest.root, start.executable);
  expect(nativePath).toMatch(/^\.gsys[\\/]native[\\/]/);
  expect(start.cwd).toBe(manifest.root);
  expect(start).not.toHaveProperty("env");
  return {
    executable: start.executable,
    args: start.args,
    cwd: manifest.root,
    diagnostics: result.stderr,
  };
}

test("Go analysis preserves native identities and generated registration serves the selected build", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await cp(source, fixture.project, { recursive: true });
      const marker = join(fixture.root, "go-init");
      const initEnv = { GO_REGISTRATION_INIT_MARKER: marker };
      const inspect = await fixture.gsys(["inspect"], { env: initEnv });
      expect(inspect.code).toBe(0);
      await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      // Multiple declarations, aliases, and native overrides preserve their own identities and scopes.
      const inspected: unknown = JSON.parse(inspect.stdout);
      expect(inspected).toMatchObject({
        definitions: expect.arrayContaining([
          expect.objectContaining({
            kind: "workflow",
            symbol: `${symbol}/workflows.Order`,
            identity: { name: "Order", state: "resolved" },
          }),
          expect.objectContaining({
            kind: "workflow",
            symbol: `${symbol}/workflows.privateReceipt`,
            identity: { name: "privateReceipt", state: "resolved" },
          }),
          expect.objectContaining({
            kind: "workflow",
            symbol: `${symbol}/workflows.LookupAlias`,
            identity: { name: "Lookup", state: "resolved" },
          }),
          expect.objectContaining({
            kind: "workflow",
            symbol: `${symbol}/workflows.AlternateOrder`,
            identity: { name: "Lookup", state: "resolved" },
            registrationScope: expect.stringContaining(":other:"),
          }),
          expect.objectContaining({
            kind: "activity",
            symbol: `(*${symbol}/activities.Orders).Load`,
            identity: { name: "alt-Load", state: "resolved" },
            registrationScope: expect.stringContaining(":other:"),
          }),
          expect.objectContaining({
            kind: "nexus",
            symbol: `${symbol}/nexus.NewCatalog`,
            identity: expect.objectContaining({ state: "dynamic" }),
            construction: expect.objectContaining({ symbol: `${symbol}/nexus.NewCatalog` }),
          }),
        ]),
      });
      for (const name of ["ExplicitReceipt", "receipt", "quote", "validate"]) {
        expect(inspected).not.toMatchObject({
          definitions: expect.arrayContaining([
            expect.objectContaining({ identity: expect.objectContaining({ name }) }),
          ]),
        });
      }
      expect(inspect.stderr).toContain(
        "warning go.callable-value-unresolved temporal/workflows/orders.go",
      );
      expect(inspect.stderr).toContain(
        "warning go.explicit-registration-unresolved temporal/workers/orders/main.go",
      );
      expect(inspect.stderr).toContain(
        "info go.private-method-excluded temporal/activities/orders.go",
      );
      expect(inspect.stderr).not.toContain("go.native-name-collision");

      const first = await buildWorker(fixture);
      const endpoint = await temporalEndpoint();
      fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
      const connectArgs = [
        "--address",
        endpoint.address,
        "--namespace",
        endpoint.namespace,
        ...isolatedConfig,
      ];
      await expect
        .poll(
          async () =>
            (
              await fixture.run("temporal", ["operator", "namespace", "describe", ...connectArgs], {
                timeout: 5_000,
              })
            ).code,
          { timeout: 30_000 },
        )
        .toBe(0);
      const nexus = await fixture.run("temporal", [
        "operator",
        "nexus",
        "endpoint",
        "create",
        ...connectArgs,
        "--name",
        "orders-endpoint",
        "--target-namespace",
        endpoint.namespace,
        "--target-task-queue",
        "orders",
      ]);
      expect(nexus.code).toBe(0);

      const env = { ...endpoint.workerEnv, ...initEnv };
      const initialWorker = fixture.start(first.executable, first.args, { env, cwd: first.cwd });
      const initial = await fixture.run("go", ["run", "./cmd/probe", "initial"], { env });
      expect(initial.code).toBe(0);
      await expect(readFile(marker, "utf8")).resolves.toBe("worker initialized");
      initialWorker.signal("SIGINT");
      expect((await initialWorker.wait(30_000)).code).toBe(0);

      // Moving a source file preserves its identities. Replacing a definition updates registration.
      const authored = await readFile(join(fixture.project, workerSource), "utf8");
      const workflowRoot = join(fixture.project, workflows);
      await rename(join(workflowRoot, "orders.go"), join(workflowRoot, "receipt.go"));
      await rm(join(workflowRoot, "legacy.go"));
      await writeFile(
        join(workflowRoot, "current.go"),
        'package workflows\nfunc Current(_ Context) (string, error) { return "current", nil }\n',
      );
      const second = await buildWorker(fixture);
      expect(second.cwd).not.toBe(first.cwd);
      await expect(readFile(join(fixture.project, workerSource), "utf8")).resolves.toBe(authored);
      await expect(
        readFile(join(workflowRoot, "zz_genesys_registration.go"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const replacement = fixture.start(second.executable, second.args, { env, cwd: second.cwd });
      const updated = await fixture.run("go", ["run", "./cmd/probe", "updated"], { env });
      expect(updated.code).toBe(0);
      await replacement.stop();

      // Duplicate names in one registry must be diagnosed, unlike the two working scopes above.
      const startOther = "if err := other.Start();";
      await writeFile(
        join(fixture.project, workerSource),
        authored.replace(startOther, "workflows.RegisterGenesys(other)\n\t" + startOther),
      );
      const conflict = await buildWorker(fixture);
      expect(conflict.diagnostics).toMatch(
        /warning go\.native-name-collision temporal\/workers\/orders\/main\.go: Native registration repeats Lookup; first at temporal\/workers\/orders\/main\.go:\d+/,
      );
      const rejected = await fixture.run(conflict.executable, conflict.args, {
        env,
        cwd: conflict.cwd,
        timeout: 15_000,
      });
      expect(rejected.code).toBe(2);
      expect(rejected.stderr).toContain('workflow name "Lookup" is already registered');

      // Two candidate mains and a Worker without a main must never produce a guessed startup.
      await mkdir(join(fixture.project, "temporal/workers/orders/second"), { recursive: true });
      await mkdir(join(fixture.project, "temporal/workers/missing"));
      await writeFile(
        join(fixture.project, "temporal/workers/orders/second/main.go"),
        "package main\nfunc main() {}\n",
      );
      await writeFile(
        join(fixture.project, "temporal/workers/missing/helper.go"),
        "package main\nfunc helper() {}\n",
      );
      const unresolved = await fixture.gsys(["inspect"]);
      expect(unresolved.code).toBe(0);
      expect(unresolved.stderr).toContain("warning go.worker-entrypoint-ambiguous");
      expect(unresolved.stderr).toContain(workerSource);
      expect(unresolved.stderr).toContain("temporal/workers/orders/second/main.go");
      expect(unresolved.stderr).toContain(
        "warning go.worker-entrypoint-unresolved temporal/workers/missing/helper.go",
      );
      expect(JSON.parse(unresolved.stdout)).toMatchObject({
        workers: expect.arrayContaining([
          expect.objectContaining({ name: "orders", workingDirectory: "." }),
          expect.objectContaining({ name: "missing", workingDirectory: "." }),
        ]),
      });
      expect(JSON.parse(unresolved.stdout)).toHaveProperty(
        "workers",
        expect.not.arrayContaining([expect.objectContaining({ start: expect.anything() })]),
      );

      // Distinct Worker directories may not share a selector name.
      const otherOrders = join(fixture.project, "other/temporal/workers/orders");
      await mkdir(otherOrders, { recursive: true });
      await writeFile(join(otherOrders, "main.go"), "package main\nfunc main() {}\n");
      const blocked = await fixture.gsys(["inspect"]);
      expect(blocked.code).toBe(1);
      expect(blocked.stderr).toContain("error worker.ambiguous-name");
      expect((await fixture.gsys(["build"])).code).toBe(1);
    },
  );
}, 720_000);
