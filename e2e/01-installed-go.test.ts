import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, constants, cp, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { expectClosedPort, posixTest as test, temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));

test("the packed CLI discovers, builds and runs Go from a project path with spaces, an apostrophe and Unicode", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      const project = join(fixture.project, "Native café's Workers");
      await mkdir(project);
      for (const path of ["go.mod", "go.sum", "temporal"])
        await cp(join(example, path), join(project, path), { recursive: true });

      const inspection = await fixture.gsys(["inspect", project]);
      expect(inspection.code).toBe(0);
      const inspected: unknown = JSON.parse(inspection.stdout);
      expect(inspected).toMatchObject({
        analysis: "native-analysis",
        definitions: expect.arrayContaining([
          expect.objectContaining({
            kind: "workflow",
            symbol: "example.com/native-workers/temporal/workflows.Greeting",
            identity: { name: "Greeting", state: "resolved" },
          }),
          expect.objectContaining({
            kind: "activity",
            symbol: "example.com/native-workers/temporal/activities.Greet",
            identity: { name: "Greet", state: "resolved" },
          }),
        ]),
        workers: [expect.objectContaining({ language: "go", name: "greeting" })],
      });

      const build = await fixture.gsys(["build", project]);
      expect(build.code).toBe(0);
      const published: unknown = JSON.parse(build.stdout);
      expect(published).toMatchObject({
        schemaVersion: 1,
        id: expect.any(String),
        projectRoot: await realpath(project),
        artifacts: expect.arrayContaining([expect.objectContaining({ kind: "registration" })]),
      });
      const selected: unknown = JSON.parse(
        await readFile(join(project, ".gsys", "compile", "manifest.json"), "utf8"),
      );
      assert(published && typeof published === "object" && "id" in published);
      expect(selected).toMatchObject({ id: published.id });

      assert("root" in published && typeof published.root === "string");
      assert("metadataPath" in published && typeof published.metadataPath === "string");
      expect(JSON.parse(await readFile(published.metadataPath, "utf8"))).toMatchObject({
        id: published.id,
        platform: process.platform,
        architecture: process.arch,
      });
      assert("workers" in published && Array.isArray(published.workers));
      const [worker]: unknown[] = published.workers;
      assert(worker && typeof worker === "object" && "start" in worker);
      assert(worker.start && typeof worker.start === "object" && "executable" in worker.start);
      const { executable } = worker.start;
      assert(typeof executable === "string" && isAbsolute(executable));
      const artifactPath = relative(published.root, executable);
      expect(isAbsolute(artifactPath)).toBe(false);
      expect(artifactPath).not.toMatch(/^\.\.(?:[/\\]|$)/);
      await access(executable, constants.X_OK);
      expect(selected).toMatchObject({
        root: published.root,
        workers: [{ name: "greeting", start: { executable } }],
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            path: artifactPath,
            kind: "native-output",
            entry: expect.objectContaining({
              kind: "file",
              mode: (await stat(executable)).mode & 0o777,
            }),
          }),
        ]),
      });
      const host = await fixture.run("go", ["env", "GOHOSTOS", "GOHOSTARCH"]);
      expect(host.code).toBe(0);
      const [goos, goarch] = host.stdout.trim().split(/\s+/);
      assert(goos && goarch, "Go did not report its host OS and architecture");
      const binary = await fixture.run("go", ["version", "-m", executable]);
      expect(binary.code).toBe(0);
      expect(binary.stdout.split("\n")).toEqual(
        expect.arrayContaining([`\tbuild\tGOOS=${goos}`, `\tbuild\tGOARCH=${goarch}`]),
      );

      const endpoint = await temporalEndpoint();
      const dev = fixture.startGsys(["dev", project, "--", ...endpoint.serverArgs], {
        env: endpoint.workerEnv,
      });
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
        const workflow = await connection.withDeadline(Date.now() + 45_000, () =>
          client.start("Greeting", {
            taskQueue: "greetings",
            workflowId: randomUUID(),
            args: ["Genesys"],
            workflowExecutionTimeout: "40s",
          }),
        );
        await expect(
          connection.withDeadline(Date.now() + 45_000, () => workflow.result()),
        ).resolves.toBe("Hello, Genesys!");
      } finally {
        await connection.close();
      }

      dev.signal("SIGINT");
      const stopped = await dev.wait(45_000);
      expect(stopped).toMatchObject({ code: 0, signal: null });
      const children = [
        ...stopped.stdout.matchAll(/^\[(temporal|greeting@[^\]]+)\] started PID (\d+);/gm),
      ];
      expect(children.map(([, name]) => name)).toEqual([
        "temporal",
        expect.stringMatching(/^greeting@/),
      ]);
      for (const [, , pid] of children)
        expect(() => process.kill(Number(pid), 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" }),
        );

      await expectClosedPort(endpoint.port);
    },
  );
}, 720_000);
