import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  selectedDevelopmentManifest,
  waitForDevelopmentBuild,
  withDevelopmentClient,
} from "./development-worker.js";
import { temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
type DevelopmentBuild = Awaited<ReturnType<typeof waitForDevelopmentBuild>>;

test("gsys retires old Go Workers after replacement readiness and cleans unused builds", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async ({ project, startGsys }) => {
      for (const path of ["go.mod", "go.sum", "temporal"])
        await cp(join(example, path), join(project, path), { recursive: true });

      const workflowSource = join(project, "temporal/workflows/greeting.go");
      const workflow = await readFile(workflowSource, "utf8");
      await writeFile(
        workflowSource,
        workflow.replace(
          "StartToCloseTimeout: time.Minute,",
          "StartToCloseTimeout: time.Minute,\n\t\tDisableEagerExecution: true,",
        ),
      );

      const workers = join(project, "temporal", "workers");
      const retained = join(workers, "retained");
      await mkdir(retained);
      const greeting = await readFile(join(workers, "greeting", "main.go"), "utf8");
      await writeFile(join(retained, "main.go"), greeting.replace('"greetings"', '"retained"'));

      const endpoint = await temporalEndpoint();
      const owner = startGsys(["dev", "--", ...endpoint.serverArgs], {
        env: { ...endpoint.workerEnv, CGO_ENABLED: "0" },
      });
      const first = await waitForDevelopmentBuild(owner, project, undefined, "greeting");
      const retainedWorker = await waitForDevelopmentBuild(owner, project, undefined, "retained");
      expect(retainedWorker.id).toBe(first.id);
      const firstManifest = await readFile(first.manifestPath, "utf8");
      const builds = dirname(dirname(first.manifestPath));
      const listBuilds = async () => (await readdir(builds)).sort();
      const retired = async ({ id, pid }: DevelopmentBuild, replacement: DevelopmentBuild) => {
        const decision = `[greeting@${id}] eligible:`;
        await expect.poll(owner.output, { timeout: 75_000 }).toContain(decision);
        const output = owner.output();
        const readiness = output.indexOf(`[greeting@${replacement.id}] observed-ready:`);
        expect(readiness).toBeGreaterThanOrEqual(0);
        expect(output.indexOf(decision)).toBeGreaterThan(readiness);
        await expect
          .poll(owner.output, { timeout: 15_000 })
          .toContain(`[greeting@${id}] exited (0)`);
        expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      };

      const third = await withDevelopmentClient(endpoint, async (client) => {
        const deadline = <T>(call: () => Promise<T>) =>
          client.connection.withDeadline(Date.now() + 5_000, call);
        const probe = async (taskQueue = "greetings") => {
          const handle = await deadline(() =>
            client.start<(name: string) => Promise<string>>("Greeting", {
              taskQueue,
              workflowId: randomUUID(),
              workflowExecutionTimeout: "20s",
              args: ["Genesys"],
            }),
          );
          const result = await deadline(() => handle.result());
          const { events } = await deadline(() => handle.fetchHistory());
          return {
            result,
            workflow: events?.find((event) => event.workflowTaskStartedEventAttributes)
              ?.workflowTaskStartedEventAttributes?.identity,
            activity: events?.find((event) => event.activityTaskStartedEventAttributes)
              ?.activityTaskStartedEventAttributes?.identity,
          };
        };
        const expectServing = async (pid: number, result = "Hello, Genesys!") => {
          const identity = expect.stringMatching(new RegExp(`^${pid}@`));
          await expect(probe()).resolves.toEqual({
            result,
            workflow: identity,
            activity: identity,
          });
        };
        const exerciseOverlap = async (pid: number) => {
          const prefix = `${pid}@`;
          let workflow = false;
          let activity = false;
          // Dispatch is native. Gather both task types even if different instances run one probe.
          await expect
            .poll(
              async () => {
                const seen = await probe();
                expect(["Hello, Genesys!", "Welcome, Genesys!"]).toContain(seen.result);
                workflow ||= seen.workflow?.startsWith(prefix) === true;
                activity ||= seen.activity?.startsWith(prefix) === true;
                return { workflow, activity };
              },
              { timeout: 20_000 },
            )
            .toEqual({ workflow: true, activity: true });
        };

        await expectServing(first.pid);
        const retainedIdentity = await probe("retained");
        const retainedPid = expect.stringMatching(new RegExp(`^${retainedWorker.pid}@`));
        expect(retainedIdentity).toEqual({
          result: "Hello, Genesys!",
          workflow: retainedPid,
          activity: retainedPid,
        });

        // Remove only the second Worker entrypoint. Its old process still uses this build.
        await rm(retained, { recursive: true });
        const second = await waitForDevelopmentBuild(owner, project, first.id, "greeting");
        await exerciseOverlap(second.pid);
        await retired(first, second);
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(firstManifest);
        await expectServing(second.pid);

        const activity = join(project, "temporal/activities/greeting.go");
        const source = await readFile(activity, "utf8");
        await writeFile(activity, source.replace('"Hello, "', '"Welcome, "'));
        const third = await waitForDevelopmentBuild(owner, project, second.id, "greeting");
        await exerciseOverlap(third.pid);
        await retired(second, third);
        await expect.poll(listBuilds, { timeout: 15_000 }).toEqual([first.id, third.id].sort());
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(firstManifest);
        await expectServing(third.pid, "Welcome, Genesys!");
        await expect(probe("retained")).resolves.toEqual(retainedIdentity);
        return third;
      });

      owner.signal("SIGINT");
      const stopped = await owner.wait(45_000);
      expect(stopped).toMatchObject({ code: 0, signal: null });
      expect(
        stopped.stdout.match(/^\[(?:retained|greeting)@[^\]]+\] started PID \d+;/gm),
      ).toHaveLength(4);
      expect(stopped.stdout).toContain(`[retained@${first.id}] exited (0)`);
      await expect(listBuilds()).resolves.toEqual([third.id]);
      await expect(readFile(selectedDevelopmentManifest(project), "utf8")).resolves.toBe(
        await readFile(third.manifestPath, "utf8"),
      );
      for (const [, pid] of stopped.stdout.matchAll(
        /^\[(?:temporal|retained@[^\]]+|greeting@[^\]]+)\] started PID (\d+);/gm,
      ))
        expect(() => process.kill(Number(pid), 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" }),
        );
    },
  );
}, 300_000);
