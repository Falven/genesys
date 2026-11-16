import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  editDevelopmentWorker,
  prepareDevelopmentWorker,
  startDevelopmentProbe,
  waitForDevelopmentBuild,
  withDevelopmentClient,
} from "./development-worker.js";
import { temporalEndpoint, withFixture } from "./fixture.js";
import { waitForObservedReady } from "./native-readiness.js";

test("V01 V02 V03: a ready replacement must preserve required work, native routing, and the old build when evidence is incomplete", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await prepareDevelopmentWorker(fixture.project);
      const endpoint = await temporalEndpoint();
      const sharedIdentity = "shared-lifecycle-worker";
      const owner = fixture.startGsys(["dev", "--", ...endpoint.serverArgs], {
        env: { ...endpoint.workerEnv, GENESYS_LIFECYCLE_WORKER_IDENTITY: sharedIdentity },
      });
      const first = await waitForDevelopmentBuild(owner, fixture.project);
      const retainedManifest = await readFile(first.manifestPath, "utf8");
      const original = { version: "v1", pid: first.pid, cwd: first.root };

      await withDevelopmentClient(endpoint, async (client) => {
        const { connection } = client;
        const { namespace } = endpoint;
        const deploymentName = "lifecycle";
        const deployment = { namespace, deploymentName };
        const native = connection.workflowService;
        const routing = async () => {
          const response = await connection.withDeadline(Date.now() + 5_000, () =>
            native.describeWorkerDeployment(deployment),
          );
          const config = response.workerDeploymentInfo?.routingConfig;
          assert(config, "Expected native deployment routing configuration");
          return config;
        };
        const setCurrent = (buildId: string) =>
          connection.withDeadline(Date.now() + 10_000, () =>
            native.setWorkerDeploymentCurrentVersion({
              ...deployment,
              buildId,
              identity: "genesys-e2e-native-client",
            }),
          );
        const pending = await startDevelopmentProbe(client, "v1", { hold: true });
        const query = () =>
          connection.withDeadline(Date.now() + 2_000, () => pending.query("observed"));
        await expect.poll(query, { timeout: 30_000 }).toEqual(original);
        const pinning = async () => {
          const execution = await connection.withDeadline(Date.now() + 5_000, () =>
            pending.describe(),
          );
          expect(execution.status.name).toBe("RUNNING");
          return execution.raw.workflowExecutionInfo?.versioningInfo?.versioningOverride;
        };
        const initialPin = await pinning();
        expect(initialPin).toMatchObject({
          pinned: { version: { deploymentName, buildId: "v1" } },
        });
        await setCurrent("v1");
        const initialRouting = await routing();
        expect(initialRouting.currentDeploymentVersion).toMatchObject({ buildId: "v1" });
        expect(initialRouting.rampingDeploymentVersion ?? null).toBeNull();

        await editDevelopmentWorker(fixture.project, "v2");
        const second = await waitForDevelopmentBuild(owner, fixture.project, first.id);
        const replacement = { version: "v2", pid: second.pid, cwd: second.root };
        const next = await startDevelopmentProbe(client, "v2");
        await expect(next.result()).resolves.toEqual(replacement);
        await waitForObservedReady(owner, { worker: "lifecycle", buildId: second.id });

        // Heartbeats identify both processes, but the shared identity cannot distinguish their pollers.
        const listed = await connection.withDeadline(Date.now() + 5_000, () =>
          native.listWorkers({ namespace }),
        );
        const shared = listed.workers.filter(
          (worker) => worker.workerIdentity === sharedIdentity && worker.taskQueue === "lifecycle",
        );
        expect(shared).toHaveLength(2);
        expect(shared).toEqual(
          expect.arrayContaining(
            [first.pid, second.pid].map((pid) =>
              expect.objectContaining({
                processId: String(pid),
                workerInstanceKey: expect.stringMatching(/\S/),
              }),
            ),
          ),
        );
        expect(new Set(shared.map((worker) => worker.workerInstanceKey)).size).toBe(2);
        await expect
          .poll(
            () => {
              const output = owner.output();
              const ready = output.lastIndexOf(`[lifecycle@${second.id}] observed-ready:`);
              if (ready < 0) return;
              return output
                .slice(ready)
                .split("\n")
                .findLast((line) => line.startsWith(`[lifecycle@${first.id}] unknown: `));
            },
            { timeout: 45_000 },
          )
          .toMatch(/\b(identity|heartbeats?|coverage)\b/i);
        await expect(routing()).resolves.toEqual(initialRouting);
        await expect(pinning()).resolves.toEqual(initialPin);
        await expect(query()).resolves.toEqual(original);
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(retainedManifest);

        await setCurrent("v2");
        const switchedRouting = await routing();
        expect(switchedRouting.currentDeploymentVersion).toMatchObject({ buildId: "v2" });
        expect(switchedRouting.rampingDeploymentVersion).toEqual(
          initialRouting.rampingDeploymentVersion,
        );
        await expect(pinning()).resolves.toEqual(initialPin);
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(retainedManifest);
        await pending.signal("release");
        await expect(pending.result()).resolves.toEqual(original);
        await expect.poll(query, { timeout: 15_000 }).toEqual(original);
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(retainedManifest);
        const afterRoutingChange = await startDevelopmentProbe(client, "v2");
        await expect(afterRoutingChange.result()).resolves.toEqual(replacement);
        await expect(routing()).resolves.toEqual(switchedRouting);
      });

      owner.signal("SIGINT");
      expect(await owner.wait(45_000)).toMatchObject({ code: 0, signal: null });
    },
  );
}, 300_000);
