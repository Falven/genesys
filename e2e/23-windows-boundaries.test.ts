import { Connection, WorkflowClient, defaultPayloadConverter } from "@temporalio/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { expectClosedPort, temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const nativeFixture = fileURLToPath(new URL("./fixtures/go-shutdown/", import.meta.url));
const startup = { timeout: 90_000 };
const shutdown = { timeout: 25_000 };
const workerStart = /^\[shutdown@[^\]]+\] started PID (\d+);/m;
const serverStart = /^\[temporal\] started PID (\d+);/m;
type Scenario = "graceful" | "forced" | "server-exit";

async function within<T>(operation: Promise<T>, timeout = shutdown.timeout): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      operation,
      delay(timeout, undefined, { signal: timer.signal }).then(() => {
        throw new Error(`Windows process operation timed out after ${timeout} ms`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}

test.skipIf(process.platform !== "win32").each<[Scenario, string]>([
  ["graceful", "preserves native paths and argv and waits for the complete Worker tree"],
  ["forced", "terminates only the owned trees after a second Ctrl-C"],
  ["server-exit", "reports a real managed Temporal failure and shuts down its Workers"],
])(
  "Windows installed CLI %s %s",
  async (scenario) => {
    await withFixture(
      [
        ["go", "version"],
        ["temporal", "--version"],
      ],
      async (fixture) => {
        const project = join(fixture.project, "native project 雪");
        const invocation = join(fixture.root, "invocation é");
        const control = join(fixture.root, "control");
        await Promise.all([mkdir(project), mkdir(invocation), mkdir(control)]);
        for (const file of ["go.mod", "go.sum"]) await cp(join(example, file), join(project, file));
        await cp(nativeFixture, project, { recursive: true });

        // Missing, mislabeled, or incorrectly selected helpers break a tarball installation.
        for (const [arch, machine] of Object.entries({ x64: 0x8664, arm64: 0xaa64 })) {
          const path = join(fixture.installed, "native", `owned-process-win32-${arch}.exe`);
          const pe = await readFile(path);
          const header = pe.readUInt32LE(0x3c);
          expect(pe.toString("ascii", header, header + 4)).toBe("PE\0\0");
          expect(pe.readUInt16LE(header + 4)).toBe(machine);
          if (arch !== process.arch) await rm(path);
        }

        const token = randomUUID();
        const sentinel = fixture.start(process.execPath, [
          "-e",
          `require("node:http").createServer((_, response) => response.end(process.argv[1]))
          .listen(0, "127.0.0.1", function () { console.log("sentinel-port=" + this.address().port); });`,
          token,
        ]);
        const sentinelPort = /^sentinel-port=(\d+)$/m;
        await expect.poll(sentinel.output, shutdown).toMatch(sentinelPort);
        const port = sentinelPort.exec(sentinel.output())?.[1];
        assert(port);
        const unrelatedIsServing = async () => {
          const response = await fetch(`http://127.0.0.1:${port}`, {
            signal: AbortSignal.timeout(2_000),
          });
          expect(response.ok).toBe(true);
          expect(await response.text()).toBe(token);
        };
        await unrelatedIsServing();

        const endpoint = await temporalEndpoint();
        const database = "Temporal state ü.sqlite";
        const argv = [
          "",
          "literal whitespace",
          "first:second",
          'escaped \\" quote',
          "雪と🧪",
          "has space\\",
          "%TEMP% !PATH! & | ^ < >",
        ];
        const cli = join(fixture.installed, "dist", "cli.js");
        const bridge = pathToFileURL(join(fixture.installed, "dist", "windows-process.js"));
        const { WindowsProcess }: typeof import("../packages/genesys/src/windows-process.js") =
          await import(bridge.href);
        let stdout = "";
        let stderr = "";

        // An outer private console delivers Ctrl-C to the installed CLI. Its job stays
        // open until the CLI and its descendants exit, including the CLI's nested jobs.
        const dev = new WindowsProcess(
          "test console",
          {
            executable: process.execPath,
            cwd: invocation,
            args: [
              cli,
              "dev",
              project,
              ...argv.map((arg) => `--worker-arg=shutdown:${arg}`),
              "--",
              ...endpoint.serverArgs,
              "--db-filename",
              database,
            ],
            env: {
              ...endpoint.workerEnv,
              NODE_PATH: "",
              GENESYS_E2E_SHUTDOWN_DIR: control,
              GENESYS_E2E_SHUTDOWN_MODE: scenario === "forced" ? "unresponsive" : "normal",
            },
          },
          (event) => {
            if (event.kind === "stdout") stdout += event.message;
            if (event.kind === "stderr") stderr += event.message;
            if (event.kind === "error") stderr += `\n${event.label}: ${event.message}\n`;
          },
        );
        const helperClosed = new Promise<void>((resolve) => dev.child.once("close", resolve));
        const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
        const request = <T>(call: () => Promise<T>) =>
          connection.withDeadline(Date.now() + 5_000, call);
        const managedIsServing = async () =>
          expect(
            await request(() =>
              connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
            ),
          ).toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
        const marker = (name: string) =>
          expect.poll(() => readFile(join(control, name), "utf8"), shutdown).toBe("");
        const release = (name: string) => writeFile(join(control, name), "");
        const members = () => within(dev.liveProcesses(), 5_000);
        const memberPids = async () => (await members()).map(({ pid }) => pid);
        const interrupt = async () => {
          await within(dev.signal(false));
          await expect.poll(() => stdout, shutdown).toContain("Requesting native Worker shutdown.");
        };
        const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
        const startProbe = (hold: boolean) =>
          request(() =>
            client.start<(hold: boolean) => Promise<number>>("ShutdownProbe", {
              taskQueue: "shutdown",
              workflowId: randomUUID(),
              workflowExecutionTimeout: "2m",
              args: [hold],
            }),
          );

        try {
          await within(dev.started);
          await expect.poll(() => stdout, startup).toMatch(workerStart);
          const serverPid = Number(serverStart.exec(stdout)?.[1]);
          const workerPid = Number(workerStart.exec(stdout)?.[1]);
          const descendantPath = join(control, "descendant-pid");
          await expect.poll(() => readFile(descendantPath, "utf8"), shutdown).toMatch(/^\d+$/);
          const descendantPid = Number(await readFile(descendantPath, "utf8"));
          const initial = await members();
          const server = initial.find(({ pid }) => pid === serverPid);
          expect(initial.map(({ pid }) => pid)).toEqual(
            expect.arrayContaining([workerPid, descendantPid, serverPid]),
          );
          expect(initial.map(({ pid }) => pid)).not.toContain(sentinel.pid);

          // Native snapshots and separate server/Worker argv and cwd must survive Windows quoting.
          const manifest: unknown = JSON.parse(
            await readFile(join(project, ".gsys", "compile", "manifest.json"), "utf8"),
          );
          assert(
            manifest &&
              typeof manifest === "object" &&
              "root" in manifest &&
              typeof manifest.root === "string",
          );
          const launch: unknown = JSON.parse(
            await readFile(join(control, "worker-launch.json"), "utf8"),
          );
          expect(launch).toMatchObject({
            args: argv,
            executable: expect.stringMatching(/\.exe$/i),
          });
          assert(
            launch &&
              typeof launch === "object" &&
              "cwd" in launch &&
              typeof launch.cwd === "string",
          );
          expect(await realpath(launch.cwd)).toBe(await realpath(manifest.root));
          await managedIsServing();
          expect((await stat(join(invocation, database))).size).toBeGreaterThan(0);
          const probe = await startProbe(false);
          await expect(
            connection.withDeadline(Date.now() + startup.timeout, () => probe.result()),
          ).resolves.toBe(workerPid);

          if (scenario === "graceful") {
            const held = await startProbe(true);
            await marker("activity-started");
            await interrupt();
            await marker("activity-stopping");
            await marker("descendant-interrupted");
            expect(await memberPids()).toEqual(
              expect.arrayContaining([workerPid, descendantPid, serverPid]),
            );
            await managedIsServing();
            await release("release-activity");
            await expect
              .poll(async () => {
                const history = await request(() => held.fetchHistory());
                const result = history.events?.find(
                  (event) => event.activityTaskCompletedEventAttributes,
                )?.activityTaskCompletedEventAttributes?.result?.payloads?.[0];
                return result && defaultPayloadConverter.fromPayload<unknown>(result);
              }, shutdown)
              .toBe(workerPid);
            await expect.poll(memberPids, shutdown).not.toContain(workerPid);
            expect(await memberPids()).toContain(descendantPid);
            await managedIsServing();
            await release("release-descendant");
          } else if (scenario === "forced") {
            await interrupt();
            await marker("worker-interrupted");
            await marker("descendant-interrupted");
            expect(await memberPids()).toEqual(
              expect.arrayContaining([workerPid, descendantPid, serverPid]),
            );
            await managedIsServing();
            await unrelatedIsServing();
            await within(dev.signal(false));
            await expect
              .poll(() => stdout, shutdown)
              .toContain("Forcing termination of owned process groups.");
          } else {
            assert(server);
            expect(await members()).toContainEqual(server);
            process.kill(serverPid, "SIGKILL");
            await expect
              .poll(() => stderr, shutdown)
              .toContain("Managed server exited; stopping owned Workers.");
            await marker("descendant-interrupted");
            await expect.poll(memberPids, shutdown).not.toContain(workerPid);
            expect(await memberPids()).toContain(descendantPid);
            await release("release-descendant");
          }

          await within(dev.done);
          await within(helperClosed);
          if (scenario !== "forced")
            expect(await dev.exited).toEqual({
              code: scenario === "graceful" ? 0 : 1,
              signal: null,
            });
          await expectClosedPort(endpoint.port);
          await unrelatedIsServing();
        } catch (error) {
          process.stderr.write(
            `Windows gsys stdout:\n${stdout.slice(-8_000)}\nstderr:\n${stderr.slice(-8_000)}\n`,
          );
          try {
            await within(dev.signal(true), 5_000);
            await within(helperClosed, 5_000);
          } catch (cleanupError) {
            dev.child.kill();
            await within(helperClosed, 5_000).catch(() => {});
            throw new AggregateError(
              [error, cleanupError],
              "Windows case and console cleanup failed",
            );
          }
          throw error;
        } finally {
          await connection.close();
        }
      },
    );
  },
  720_000,
);
