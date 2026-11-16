import { Connection, WorkflowClient, defaultPayloadConverter } from "@temporalio/client";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { expectClosedPort, posixTest as test, temporalEndpoint, withFixture } from "./fixture.js";
import { launchTree, liveProcesses, sameProcess } from "./posix-processes.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const nativeFixture = fileURLToPath(new URL("./fixtures/go-shutdown/", import.meta.url));
const startup = { timeout: 90_000 };
const shutdown = { timeout: 25_000 };
const requesting = "Requesting native Worker shutdown. Waiting without a deadline";
const forcing = "Forcing termination of owned process groups.";

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];
type ShutdownProbe = (hold: boolean) => Promise<number>;
type Scenario = "graceful" | "forced" | "worker-exit" | "server-exit";

function numberFrom(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  assert.ok(match, `Missing positive integer matching ${pattern}`);
  const value = Number(match[1]);
  assert.ok(Number.isSafeInteger(value) && value > 0, `Invalid positive integer: ${match[1]}`);
  return value;
}

async function runSession(
  fixture: Fixture,
  scenario: Scenario,
  sentinel: { pid: number; verify: () => Promise<void> },
) {
  const endpoint = await temporalEndpoint();
  const control = join(fixture.root, randomUUID());
  await mkdir(control);
  const dev = fixture.startGsys(["dev", "--", ...endpoint.serverArgs], {
    env: {
      ...endpoint.workerEnv,
      GENESYS_E2E_SHUTDOWN_DIR: control,
      GENESYS_E2E_SHUTDOWN_MODE: scenario === "forced" ? "unresponsive" : "normal",
    },
  });
  const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
  const withinDeadline = <T>(call: () => Promise<T>) =>
    connection.withDeadline(Date.now() + 5_000, call);
  const namespace = () =>
    withinDeadline(() =>
      connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
    );
  const serving = async () =>
    expect(await namespace()).toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
  const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
  const startProbe = (hold: boolean) =>
    withinDeadline(() =>
      client.start<ShutdownProbe>("ShutdownProbe", {
        taskQueue: "shutdown",
        workflowId: randomUUID(),
        workflowExecutionTimeout: "2m",
        args: [hold],
      }),
    );
  const marker = (name: string) =>
    expect.poll(() => readFile(join(control, name), "utf8"), shutdown).toBe("");
  const release = (name: string) => writeFile(join(control, name), "");
  const temporalStart = /^\[temporal\] started PID (\d+);/m;
  const workerStart = /^\[shutdown@[^\]]+\] started PID (\d+);/m;
  const owned: Awaited<ReturnType<typeof liveProcesses>> = [];
  try {
    const descendantPath = join(control, "descendant-pid");
    const capture = async () => {
      const processes = await liveProcesses();
      const byPid = new Map(processes.map((identity) => [identity.pid, identity]));
      const members = launchTree(byPid, dev.pid);
      for (const identity of processes)
        if (members.has(identity.pid) && !owned.some((previous) => sameProcess(previous, identity)))
          owned.push(identity);
      return byPid;
    };
    await expect.poll(dev.output, startup).toMatch(temporalStart);
    await capture();
    await expect.poll(dev.output, startup).toMatch(workerStart);
    await capture();
    await expect.poll(() => readFile(descendantPath, "utf8"), shutdown).toMatch(/^\d+$/);
    const byPid = await capture();
    const serverPid = numberFrom(dev.output(), temporalStart);
    const workerPid = numberFrom(dev.output(), workerStart);
    const descendantPid = numberFrom(await readFile(descendantPath, "utf8"), /^(\d+)$/);

    const find = (pid: number) => {
      const found = byPid.get(pid);
      assert.ok(found, `Process ${pid} is absent from native census`);
      return found;
    };
    const worker = find(workerPid);
    const server = find(serverPid);
    const descendant = find(descendantPid);
    const outside = find(sentinel.pid);
    const ownerPid = dev.pid;
    assert.ok(ownerPid);
    const owner = find(ownerPid);
    for (const target of [worker, server, descendant])
      expect(owned.some((identity) => sameProcess(identity, target))).toBe(true);
    const groups = new Set([worker.group, server.group]);
    expect(groups.size).toBe(2);
    expect(groups.has(outside.group)).toBe(false);
    expect(groups.has(owner.group)).toBe(false);
    expect(descendant.group).toBe(worker.group);
    const live = async (identity: (typeof owned)[number]) =>
      (await liveProcesses()).some((process) => sameProcess(process, identity));
    const request = async () => {
      dev.signal("SIGINT");
      await expect.poll(dev.output, shutdown).toContain(requesting);
    };

    await serving();
    const probe = await startProbe(false);
    await expect(
      connection.withDeadline(Date.now() + startup.timeout, () => probe.result()),
    ).resolves.toBe(workerPid);

    if (scenario === "graceful") {
      const held = await startProbe(true);
      await marker("activity-started");
      await request();
      await marker("activity-stopping");
      await serving();
      expect(await live(worker)).toBe(true);
      expect(await live(descendant)).toBe(true);
      await release("release-activity");
      await expect
        .poll(async () => {
          const history = await withinDeadline(() => held.fetchHistory());
          const payload = history.events?.find(
            (event) => event.activityTaskCompletedEventAttributes,
          )?.activityTaskCompletedEventAttributes?.result?.payloads?.[0];
          return payload && defaultPayloadConverter.fromPayload<unknown>(payload);
        }, shutdown)
        .toBe(workerPid);
      await expect.poll(() => live(worker), shutdown).toBe(false);
      expect(await live(descendant)).toBe(true);
      await serving();
      await release("release-descendant");
    } else if (scenario === "forced") {
      await request();
      await marker("worker-interrupted");
      await marker("descendant-interrupted");
      await serving();
      expect(await live(worker)).toBe(true);
      expect(await live(descendant)).toBe(true);
      await sentinel.verify();
      dev.signal("SIGINT");
    } else if (scenario === "worker-exit") {
      expect(await live(worker)).toBe(true);
      process.kill(workerPid, "SIGKILL");
      await expect.poll(dev.output, shutdown).toMatch(/^\[shutdown@[^\]]+\] exited \(SIGKILL\)/m);
      await expect
        .poll(dev.output, shutdown)
        .toContain(
          "Worker process exited; its build remains retained until the owned process group exits.",
        );
      expect(await live(descendant)).toBe(true);
      await serving();
      await request();
      await release("release-descendant");
    } else {
      expect(await live(server)).toBe(true);
      process.kill(serverPid, "SIGKILL");
      await expect.poll(dev.output, shutdown).toContain("[temporal] exited (SIGKILL)");
      await expect
        .poll(dev.output, shutdown)
        .toContain("Managed server exited; stopping owned Workers.");
      await expect.poll(() => live(worker), shutdown).toBe(false);
      expect(await live(descendant)).toBe(true);
      await release("release-descendant");
    }

    const result = await dev.wait(shutdown.timeout);
    expect(result.signal).toBeNull();
    expect(result.stdout.match(new RegExp(temporalStart.source, "gm"))).toHaveLength(1);
    expect(result.stdout.match(new RegExp(workerStart.source, "gm"))).toHaveLength(1);
    if (scenario === "graceful") {
      expect(result.code).toBe(0);
      const workerExit = result.stdout.search(/^\[shutdown@[^\]]+\] exited \(0\)/m);
      const temporalExit = result.stdout.search(/^\[temporal\] exited \(/m);
      expect(workerExit).toBeGreaterThanOrEqual(0);
      expect(temporalExit).toBeGreaterThan(workerExit);
    } else if (scenario === "forced") {
      expect(result.stdout).toContain(forcing);
    } else {
      expect(result.code).toBe(1);
    }
    await expect
      .poll(
        async () => (await liveProcesses()).filter((identity) => groups.has(identity.group)),
        shutdown,
      )
      .toEqual([]);
    await expectClosedPort(endpoint.port);
    await sentinel.verify();
  } catch (error) {
    // Preserve the process census before emergency cleanup can change it.
    try {
      const live = await liveProcesses();
      const remaining = live.filter((identity) =>
        owned.some((original) => sameProcess(identity, original)),
      );
      process.stderr.write(
        `${dev.output()}\nOwned process census before cleanup: ${JSON.stringify(remaining)}\n`,
      );
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Shutdown case and cleanup failed");
    }
    throw error;
  } finally {
    await connection.close();
  }
}

test.each<[Scenario, string]>([
  [
    "graceful",
    "keeps Temporal serving through native Activity completion and Worker-tree exit across two starts and stops",
  ],
  ["forced", "forces only the owned tree after a second interrupt"],
  ["worker-exit", "preserves a real Worker failure and keeps the managed server available"],
  ["server-exit", "preserves a real Temporal failure and shuts down the owned Worker tree"],
])(
  "gsys shutdown %s %s",
  async (scenario) => {
    await withFixture(
      [
        ["go", "version"],
        ["temporal", "--version"],
      ],
      async (fixture) => {
        for (const path of ["go.mod", "go.sum"])
          await cp(join(example, path), join(fixture.project, path));
        await cp(nativeFixture, fixture.project, { recursive: true });

        const token = randomUUID();
        const service = fixture.start(process.execPath, [
          "-e",
          `require("node:http").createServer((_, response) => response.end(process.argv[1]))
        .listen(0, "127.0.0.1", function () { console.log("sentinel-port=" + this.address().port); });`,
          token,
        ]);
        const sentinelPort = /^sentinel-port=(\d+)$/m;
        await expect.poll(service.output, shutdown).toMatch(sentinelPort);
        const port = numberFrom(service.output(), sentinelPort);
        const pid = service.pid;
        assert.ok(pid);
        const sentinel = {
          pid,
          verify: async () => {
            const response = await fetch(`http://127.0.0.1:${port}`, {
              signal: AbortSignal.timeout(2_000),
            });
            expect(response.ok).toBe(true);
            expect(await response.text()).toBe(token);
          },
        };
        await sentinel.verify();
        await runSession(fixture, scenario, sentinel);
        if (scenario === "graceful") await runSession(fixture, scenario, sentinel);
      },
    );
  },
  720_000,
);
