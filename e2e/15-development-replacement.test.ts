import { appendFile, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  editDevelopmentWorker,
  prepareDevelopmentWorker,
  selectedDevelopmentManifest,
  startDevelopmentProbe,
  waitForDevelopmentBuild,
  withDevelopmentClient,
} from "./development-worker.js";
import { temporalEndpoint, withFixture } from "./fixture.js";

test("W01 W02 B06 L01: a failed edit can strand the watcher, displace live work, or launch the wrong build", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await prepareDevelopmentWorker(fixture.project);
      const activity = "temporal/activities/probe.go";
      const activityPath = join(fixture.project, activity);
      const authoredActivity = await readFile(activityPath, "utf8");
      const versionPath = join(fixture.project, "version.go");
      const authoredVersion = await readFile(versionPath, "utf8");
      const manifest = selectedDevelopmentManifest(fixture.project);
      const endpoint = await temporalEndpoint();

      await appendFile(activityPath, "\nfunc RegisterGenesys() {}\n");
      const owner = fixture.startGsys(["dev", "--", ...endpoint.serverArgs], {
        env: endpoint.workerEnv,
      });
      const waitForOutput = (text: string) =>
        expect.poll(owner.output, { timeout: 60_000 }).toContain(text);
      const recovered =
        "Replacement failed; existing Workers and Temporal remain active. Watching for edits.";
      await waitForOutput(`Service health observed at ${endpoint.address}`);
      await waitForOutput("Authored symbol conflicts with generated RegisterGenesys");
      await waitForOutput(recovered);
      await expect(readFile(manifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const attached = fixture.startGsys(["dev"]);
      await expect
        .poll(attached.output, { timeout: 15_000 })
        .toContain("Reusing the existing supervisor.");
      await writeFile(activityPath, authoredActivity);
      const first = await waitForDevelopmentBuild(owner, fixture.project);

      const generations = [first];
      await withDevelopmentClient(endpoint, async (client) => {
        const pending = await startDevelopmentProbe(client, "v1", { hold: true });
        const original = { version: "v1", pid: first.pid, cwd: first.root };
        const query = () =>
          client.connection.withDeadline(Date.now() + 2_000, () => pending.query("observed"));
        await expect.poll(query, { timeout: 30_000 }).toEqual(original);
        const selected = await readFile(manifest, "utf8");

        // The Go package type-checks, then its native link fails on this symbol.
        await writeFile(
          versionPath,
          authoredVersion.replace('"strings"', '"strings"\n\t_ "unsafe"') +
            "\n//go:linkname compileFailure unlinked.watchCompileFailure\nfunc compileFailure()\nfunc init() { compileFailure() }\n",
        );
        await waitForOutput("relocation target unlinked.watchCompileFailure not defined");
        expect(await readFile(manifest, "utf8")).toBe(selected);
        await expect(query()).resolves.toEqual(original);

        await writeFile(
          versionPath,
          authoredVersion.replace('"strings"', '"strings"\n\t"log"') +
            '\nfunc init() { log.Fatal("lifecycle startup failure") }\n',
        );
        const failed = await waitForDevelopmentBuild(owner, fixture.project, first.id);
        generations.push(failed);
        await waitForOutput("lifecycle startup failure");
        await waitForOutput(`[lifecycle@${failed.id}] exited (1)`);
        await expect(query()).resolves.toEqual(original);

        const lastBuildStart = () =>
          owner
            .output()
            .match(/^\[build@[^\]]+\] started PID /gm)
            ?.at(-1);
        const beforeRepair = lastBuildStart();
        await editDevelopmentWorker(fixture.project, "v2");
        await expect.poll(lastBuildStart, { timeout: 60_000 }).not.toBe(beforeRepair);
        const duringReplacement = await startDevelopmentProbe(client, "v1");
        await expect(duringReplacement.result()).resolves.toEqual(original);
        const second = await waitForDevelopmentBuild(owner, fixture.project, failed.id);
        generations.push(second);
        const next = await startDevelopmentProbe(client, "v2");
        const replacement = { version: "v2", pid: second.pid, cwd: second.root };
        await expect(next.result()).resolves.toEqual(replacement);
        await expect(query()).resolves.toEqual(original);

        const generated = "temporal/activities/zz_genesys_registration.go";
        await cp(join(second.root, generated), join(fixture.project, generated));
        // The watcher emits no event for ignored files. This delay can detect extra builds
        // during the run. It gives no evidence of when the watcher received the change.
        const afterGeneratedOutput = await startDevelopmentProbe(client, "v2", {
          startDelay: "2s",
        });
        await expect(afterGeneratedOutput.result()).resolves.toEqual(replacement);
        expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({ id: second.id });

        await appendFile(
          join(fixture.project, "go.mod"),
          "\n// lifecycle-build-suffix: -package\n",
        );
        const packaged = await waitForDevelopmentBuild(owner, fixture.project, second.id);
        generations.push(packaged);
        const packageProbe = await startDevelopmentProbe(client, "v2-package");
        await expect(packageProbe.result()).resolves.toEqual({
          version: "v2-package",
          pid: packaged.pid,
          cwd: packaged.root,
        });
        await expect(readFile(first.manifestPath, "utf8")).resolves.toBe(selected);
        await pending.signal("release");
        await expect(pending.result()).resolves.toEqual(original);

        attached.signal("SIGINT");
        expect(await attached.wait(10_000)).toMatchObject({ code: 0, signal: null });
        const afterDetach = await startDevelopmentProbe(client, "v2-package");
        await expect(afterDetach.result()).resolves.toMatchObject({ pid: packaged.pid });
        expect(JSON.parse(await readFile(manifest, "utf8"))).toMatchObject({ id: packaged.id });
      });

      owner.signal("SIGINT");
      const stopped = await owner.wait(45_000);
      expect(stopped).toMatchObject({ code: 1, signal: null });
      expect(stopped.stdout.match(/^\[build\] Building source changes /gm)).toHaveLength(6);
      expect(
        stopped.stderr.match(/Replacement failed; existing Workers and Temporal remain active/g),
      ).toHaveLength(2);
      const launches = [...stopped.stdout.matchAll(/^\[lifecycle@([^\]]+)\] started PID (\d+);/gm)];
      expect(launches.map(([, id, pid]) => ({ id, pid: Number(pid) }))).toEqual(
        generations.map(({ id, pid }) => ({ id, pid })),
      );
      expect(stopped.stdout).not.toContain(`[lifecycle@${generations[1]?.id}] observed-ready:`);
      const servers = [...stopped.stdout.matchAll(/^\[temporal\] started PID (\d+);/gm)];
      expect(servers).toHaveLength(1);
      for (const [, pid] of servers)
        expect(() => process.kill(Number(pid), 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" }),
        );
      for (const { pid } of generations)
        expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    },
  );
}, 480_000);
