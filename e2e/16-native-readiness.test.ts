import { Connection, isGrpcServiceError, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";
import { readinessReport, waitForObservedReady } from "./native-readiness.js";

const source = fileURLToPath(new URL("./fixtures/go-readiness/temporal/", import.meta.url));
const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const primary = "readiness-primary";
const secondary = "readiness-secondary";
const hidden = "readiness-hidden";
const observation = { timeout: 45_000, interval: 250 };
const evidenceFreshness = 120_000;
const workerStatusRunning = 1;
const grpcNotFound = 5;

async function readLaunch(project: string) {
  const path = join(project, ".gsys", "compile", "manifest.json");
  const manifest: unknown = JSON.parse(await readFile(path, "utf8"));
  assert(
    manifest &&
      typeof manifest === "object" &&
      "id" in manifest &&
      typeof manifest.id === "string" &&
      "workers" in manifest &&
      Array.isArray(manifest.workers),
  );
  const observer: unknown = manifest.workers.find(
    (worker: unknown) =>
      worker && typeof worker === "object" && "name" in worker && worker.name === "observer",
  );
  assert(observer && typeof observer === "object" && "start" in observer);
  const { start } = observer;
  assert(
    start &&
      typeof start === "object" &&
      "executable" in start &&
      typeof start.executable === "string" &&
      "cwd" in start &&
      typeof start.cwd === "string" &&
      "args" in start &&
      Array.isArray(start.args) &&
      start.args.every((arg: unknown) => typeof arg === "string"),
  );
  return { buildId: manifest.id, executable: start.executable, cwd: start.cwd, args: start.args };
}

async function supervisorStatus(project: string) {
  const path = join(project, ".gsys", "dev", "supervisor.json");
  const record: unknown = JSON.parse(await readFile(path, "utf8"));
  assert(
    record &&
      typeof record === "object" &&
      "url" in record &&
      typeof record.url === "string" &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(record.url),
  );
  const response = await fetch(`${record.url}/status`, { signal: AbortSignal.timeout(5_000) });
  expect(response.status).toBe(200);
  return response.text();
}

test("installed dev reports only native readiness observed for the owned Worker generation", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await Promise.all([
        cp(source, join(fixture.project, "temporal"), { recursive: true }),
        cp(join(example, "go.mod"), join(fixture.project, "go.mod")),
        cp(join(example, "go.sum"), join(fixture.project, "go.sum")),
      ]);
      const endpoint = await temporalEndpoint();
      const owner = fixture.startGsys(
        [
          "dev",
          "--",
          ...endpoint.serverArgs,
          "--dynamic-config-value",
          "frontend.WorkerHeartbeatsEnabled=true",
        ],
        { env: { ...endpoint.workerEnv, GENESYS_READINESS_CONTROL: fixture.root } },
      );
      const gate = (name: string) => writeFile(join(fixture.root, name), "");
      await expect
        .poll(() => owner.output(), { timeout: 180_000 })
        .toMatch(/\[startup-only@[^\]]+\] Worker ready: startup-only program is alive/);
      const launch = await readLaunch(fixture.project);
      const observer = { worker: "observer", buildId: launch.buildId };
      const startupOnly = `[startup-only@${launch.buildId}]`;
      const pid = Number(
        owner
          .output()
          .split("\n")
          .find((line) => line.startsWith(`[observer@${launch.buildId}] started PID `))
          ?.match(/ started PID (\d+);/)?.[1],
      );
      assert(Number.isSafeInteger(pid) && pid > 0, owner.output());

      const connection = await Connection.connect({
        address: endpoint.address,
        connectTimeout: "10s",
      });
      try {
        const { namespace } = endpoint;
        const client = new WorkflowClient({ connection, namespace });
        const probe = (queue: string, remote: boolean) =>
          connection.withDeadline(Date.now() + 20_000, () =>
            client.execute("ReadinessProbe", {
              taskQueue: queue,
              workflowId: randomUUID(),
              args: [remote],
              workflowExecutionTimeout: "15s",
            }),
          );
        const nativeInstance = async (queue: string, processId: number) => {
          const listed = await connection.withDeadline(Date.now() + 5_000, () =>
            connection.workflowService.listWorkers({ namespace }),
          );
          return (
            listed.workers.find(
              (entry) => entry.taskQueue === queue && entry.processId === String(processId),
            )?.workerInstanceKey ?? undefined
          );
        };
        const heartbeat = async (instanceKey: string | undefined) => {
          if (!instanceKey) return undefined;
          try {
            const response = await connection.withDeadline(Date.now() + 5_000, () =>
              connection.workflowService.describeWorker({
                namespace,
                workerInstanceKey: instanceKey,
              }),
            );
            return response.workerInfo?.workerHeartbeat;
          } catch (error) {
            if (isGrpcServiceError(error) && error.code === grpcNotFound) return undefined;
            throw error;
          }
        };
        const successfulPolls = (sample: Awaited<ReturnType<typeof heartbeat>>) => ({
          workflow: !!sample?.workflowPollerInfo?.lastSuccessfulPollTime,
          activity: !!sample?.activityPollerInfo?.lastSuccessfulPollTime,
          nexus: !!sample?.nexusPollerInfo?.lastSuccessfulPollTime,
        });
        const row = (key: string, queue: string, state: string) =>
          `${namespace}/${key} queue=${queue} PID=${pid}: ${state}`;
        const report = () => readinessReport(owner, observer);

        // A ready-looking log and another process's successful polls cannot prove readiness.
        const unrelated = fixture.start(launch.executable, [...launch.args, "unrelated"], {
          cwd: launch.cwd,
          env: endpoint.workerEnv,
        });
        assert(unrelated.pid);
        const unrelatedPid = unrelated.pid;
        await expect(probe(primary, true)).resolves.toBe(unrelatedPid);
        await expect
          .poll(
            async () =>
              successfulPolls(await heartbeat(await nativeInstance(primary, unrelatedPid))),
            observation,
          )
          .toEqual({ workflow: true, activity: true, nexus: false });
        await gate("start-primary");
        await expect
          .poll(() => nativeInstance(primary, pid), observation)
          .toEqual(expect.any(String));
        const firstKey = await nativeInstance(primary, pid);
        assert(firstKey);
        await expect.poll(report, observation).toEqual({
          summary: expect.stringMatching(/^unknown: /),
          instances: [row(firstKey, primary, "unknown")],
        });
        await expect(supervisorStatus(fixture.project)).resolves.toContain(
          `${startupOnly} running; unknown:`,
        );

        unrelated.signal("SIGINT");
        expect((await unrelated.wait(20_000)).code).toBe(0);
        await expect(probe(primary, true)).resolves.toBe(pid);
        await expect
          .poll(async () => successfulPolls(await heartbeat(firstKey)), observation)
          .toEqual({ workflow: true, activity: true, nexus: false });
        await waitForObservedReady(owner, observer);
        expect(report()).toEqual({
          summary: expect.stringContaining("coverage is limited to observed task types"),
          instances: [row(firstKey, primary, "observed-ready")],
        });

        // A newly enumerated instance must provide its own successful task evidence.
        await gate("start-secondary");
        await expect
          .poll(() => nativeInstance(secondary, pid), observation)
          .toEqual(expect.any(String));
        const secondKey = await nativeInstance(secondary, pid);
        assert(secondKey);
        expect(secondKey).not.toBe(firstKey);
        await expect.poll(report, observation).toEqual({
          summary: expect.stringMatching(/^unknown: /),
          instances: expect.arrayContaining([
            row(firstKey, primary, "observed-ready"),
            row(secondKey, secondary, "unknown"),
          ]),
        });
        expect(report()?.instances).toHaveLength(2);
        await expect(probe(secondary, false)).resolves.toBe(pid);
        await expect(probe(hidden, true)).resolves.toBe(pid);
        await expect
          .poll(async () => {
            const sample = await heartbeat(secondKey);
            return { status: sample?.status, ...successfulPolls(sample) };
          }, observation)
          .toEqual({ status: workerStatusRunning, workflow: true, activity: false, nexus: false });
        await waitForObservedReady(owner, observer);
        expect(report()?.summary).toContain("heartbeat-disabled Workers are not enumerated");
        expect(report()?.instances).toHaveLength(2);
        expect(report()?.instances).toEqual(
          expect.arrayContaining([
            row(firstKey, primary, "observed-ready"),
            row(secondKey, secondary, "observed-ready"),
          ]),
        );
        const status = await supervisorStatus(fixture.project);
        expect(status).toContain(`[observer@${launch.buildId}] running; observed-ready:`);
        expect(status).toContain(`${startupOnly} running; unknown:`);

        // Worker.Stop can leave a running heartbeat visible until its evidence expires.
        await gate("stop-secondary");
        await expect
          .poll(() => owner.output(), observation)
          .toContain("Secondary native Worker stopped");
        await expect
          .poll(
            async () => {
              const sample = await heartbeat(secondKey);
              if (!sample || sample.status !== workerStatusRunning) return false;
              const now = Date.now();
              return [
                sample.heartbeatTime,
                sample.workflowPollerInfo?.lastSuccessfulPollTime,
              ].every(
                (time) =>
                  time != null &&
                  now - (Number(time.seconds) * 1_000 + (time.nanos ?? 0) / 1_000_000) <=
                    evidenceFreshness,
              );
            },
            { timeout: evidenceFreshness + observation.timeout, interval: 1_000 },
          )
          .toBe(false);
        await expect(probe(primary, true)).resolves.toBe(pid);
        await expect.poll(report, observation).toEqual({
          summary: expect.stringMatching(/^unknown: /),
          instances: expect.arrayContaining([
            row(firstKey, primary, "observed-ready"),
            row(secondKey, secondary, "unknown"),
          ]),
        });
        await expect(supervisorStatus(fixture.project)).resolves.toContain(
          `[observer@${launch.buildId}] running; unknown:`,
        );
      } finally {
        await connection.close();
      }
      owner.signal("SIGINT");
      expect((await owner.wait(45_000)).code).toBe(0);
    },
  );
}, 720_000);
