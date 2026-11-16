import { Connection, WorkflowClient } from "@temporalio/client";
import { randomUUID } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const buildStarted = "[build] Building source changes while existing Workers remain active.";
const replacementFailed = "Replacement failed; existing Workers and Temporal remain active.";

function launches(output: string) {
  return [...output.matchAll(/^\[(temporal|greeting@[^\]]+)\] started PID (\d+);/gm)].map(
    ([, label, pid]) => ({ label, pid: Number(pid) }),
  );
}

function supervisorStatus(url: string) {
  return fetch(`${url}/status`, {
    headers: { connection: "close" },
    signal: AbortSignal.timeout(5_000),
  });
}

async function greet({ address, namespace }: Awaited<ReturnType<typeof temporalEndpoint>>) {
  const connection = await Connection.connect({ address, connectTimeout: "30s" });
  try {
    await expect
      .poll(
        () =>
          connection.withDeadline(Date.now() + 5_000, () =>
            connection.workflowService.describeNamespace({ namespace }),
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({ namespaceInfo: { name: namespace } });
    const client = new WorkflowClient({ connection, namespace });
    const result = await connection.withDeadline(Date.now() + 55_000, () =>
      client.execute("Greeting", {
        taskQueue: "greetings",
        workflowId: randomUUID(),
        args: ["Genesys"],
        workflowExecutionTimeout: "45s",
      }),
    );
    expect(result).toBe("Hello, Genesys!");
  } finally {
    await connection.close();
  }
}

test("supervisor reuse preserves one owner and stale records allow a fresh native session", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      for (const path of ["go.mod", "go.sum", "temporal"])
        await cp(join(example, path), join(fixture.project, path), { recursive: true });

      const recordPath = join(fixture.project, ".gsys", "dev", "supervisor.json");
      const manifestPath = join(fixture.project, ".gsys", "compile", "manifest.json");
      await expect(readFile(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
      const endpoint = await temporalEndpoint();
      const startup = ["dev", "--", ...endpoint.serverArgs];
      const owner = fixture.startGsys(startup, { env: endpoint.workerEnv });
      await greet(endpoint);
      const manifest = await readFile(manifestPath, "utf8");
      const build: unknown = JSON.parse(manifest);
      if (!build || typeof build !== "object" || !("id" in build) || typeof build.id !== "string")
        throw new Error("The selected build must have an ID");
      const worker = `greeting@${build.id}`;
      const children = launches(owner.output());
      expect(children.map(({ label }) => label)).toEqual(["temporal", worker]);

      const record = await readFile(recordPath, "utf8");
      const supervisor: unknown = JSON.parse(record);
      if (
        !supervisor ||
        typeof supervisor !== "object" ||
        !("url" in supervisor) ||
        typeof supervisor.url !== "string" ||
        !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(supervisor.url)
      )
        throw new Error("Expected a loopback supervisor endpoint");
      const url = supervisor.url;
      const status = await supervisorStatus(url);
      expect(status.status).toBe(200);
      expect(await status.text()).toContain(`[${worker}] running;`);

      const secondary = fixture.startGsys(["dev"], { env: endpoint.workerEnv });
      await expect.poll(secondary.output, { timeout: 10_000 }).toContain(`[${worker}] running;`);
      expect(secondary.output()).toContain("Reusing the existing supervisor.");
      const reconfigure = await fixture.gsys(startup, { env: endpoint.workerEnv, timeout: 10_000 });
      expect(reconfigure.code).toBe(1);
      expect(reconfigure.stderr).toContain("Startup options cannot reconfigure a reused session");

      // An invalid edit exercises both CLIs while the original Worker keeps serving.
      const source = join(fixture.project, "temporal", "workflows", "greeting.go");
      const original = await readFile(source, "utf8");
      await writeFile(source, `${original}\nfunc brokenGoSource(\n`);
      await expect.poll(secondary.output, { timeout: 60_000 }).toContain(replacementFailed);
      await greet(endpoint);

      secondary.signal("SIGINT");
      const disconnected = await secondary.wait(10_000);
      expect(disconnected).toMatchObject({ code: 0, signal: null });
      expect(disconnected.stdout.split(buildStarted)).toHaveLength(2);
      expect(launches(disconnected.stdout)).toEqual([]);
      await greet(endpoint);
      expect(await readFile(manifestPath, "utf8")).toBe(manifest);
      expect(await readFile(recordPath, "utf8")).toBe(record);
      for (const { pid } of children) expect(process.kill(pid, 0)).toBe(true);
      const persisted = await supervisorStatus(url);
      expect(persisted.status).toBe(200);
      expect(await persisted.text()).toContain(`[${worker}] running;`);

      owner.signal("SIGINT");
      const stopped = await owner.wait(45_000);
      expect(stopped).toMatchObject({ code: 0, signal: null });
      expect(stopped.stdout.split(buildStarted)).toHaveLength(3);
      expect(stopped.stderr.split(replacementFailed)).toHaveLength(2);
      expect(launches(stopped.stdout)).toEqual(children);

      // The last real endpoint stays on disk after its owner stops.
      expect(await readFile(recordPath, "utf8")).toBe(record);
      await expect(supervisorStatus(url)).rejects.toMatchObject({
        cause: { code: "ECONNREFUSED" },
      });
      await writeFile(source, original);
      const next = await temporalEndpoint();
      const nextOwner = fixture.startGsys(["dev", "--", ...next.serverArgs], {
        env: next.workerEnv,
      });
      await greet(next);
      nextOwner.signal("SIGINT");
      const nextStopped = await nextOwner.wait(45_000);
      expect(nextStopped).toMatchObject({ code: 0, signal: null });
      expect(launches(nextStopped.stdout).map(({ label }) => label)).toEqual([
        "temporal",
        expect.stringMatching(/^greeting@/),
      ]);
    },
  );
}, 720_000);
