import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, chmod, cp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, WorkflowClient } from "@temporalio/client";
import { expect } from "vitest";
import { expectClosedPort, posixTest as test, temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/dev-launch/", import.meta.url));
const nativePackage = "native app";

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];
type Session = ReturnType<Fixture["startGsys"]>;
type Endpoint = Awaited<ReturnType<typeof temporalEndpoint>>;

async function withClient<T>(endpoint: Endpoint, run: (client: WorkflowClient) => Promise<T>) {
  const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "25s" });
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
    return await connection.withDeadline(Date.now() + 50_000, () => run(client));
  } finally {
    await connection.close();
  }
}

function runProbe(
  client: WorkflowClient,
  name: string,
  workflowId = randomUUID(),
): Promise<unknown> {
  return client.execute("InspectLaunch", {
    workflowId,
    taskQueue: name,
    workflowExecutionTimeout: "45s",
  });
}

async function workerDirectory(project: string) {
  const manifest: unknown = JSON.parse(
    await readFile(join(project, ".gsys", "compile", "manifest.json"), "utf8"),
  );
  assert(manifest && typeof manifest === "object" && "root" in manifest);
  assert(typeof manifest.root === "string");
  return realpath(join(manifest.root, nativePackage));
}

function startedWorkers(stdout: string) {
  return [...stdout.matchAll(/^\[(alpha|beta)@[^\]]+\] started PID \d+;/gm)]
    .map(([, name]) => name)
    .sort();
}

async function temporalCommand(fixture: Fixture, session: Session) {
  const pid = /^\[temporal\] started PID (\d+);/m.exec(session.output())?.[1];
  assert(pid, "Expected Genesys to report the managed Temporal PID");
  const result = await fixture.run("ps", ["-ww", "-o", "command=", "-p", pid]);
  expect(result.code).toBe(0);
  return result.stdout.trim().replace(/^.*? server start-dev /, "server start-dev ");
}

async function stopSession(session: Session) {
  session.signal("SIGINT");
  const result = await session.wait(45_000);
  expect(result).toMatchObject({ code: 0, signal: null });
  return result.stdout;
}

async function inTerminal(
  { start, executable }: Fixture,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  check: (session: Session) => Promise<void>,
) {
  const command = [
    "sh",
    "-c",
    'test -t 0 && test -t 1 || exit 1; printf "TTY supervisor PID %s\\n" "$$"; exec "$@"',
    "gsys-tty",
    executable,
    ...args,
  ];
  const scriptArgs =
    process.platform === "darwin"
      ? ["-q", "/dev/null", ...command]
      : [
          "-q",
          "-e",
          "-c",
          command.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" "),
          "/dev/null",
        ];
  const session = start("script", scriptArgs, { ...options, trackGroups: true });
  let owner: number | undefined;
  let result: Awaited<ReturnType<Session["wait"]>> | undefined;
  const failures: unknown[] = [];
  try {
    await expect
      .poll(() => {
        const pid = /TTY supervisor PID (\d+)/.exec(session.output())?.[1];
        if (pid) owner = Number(pid);
        return owner;
      })
      .toBeGreaterThan(0);
    await check(session);
  } catch (error) {
    failures.push(error);
  }
  if (owner !== undefined) {
    try {
      await session.signalDescendant(owner, "SIGINT");
      result = await session.wait(45_000);
      expect(result).toMatchObject({ code: 0, signal: null });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "TTY case and shutdown failed");
  assert(result);
  return result.stdout;
}

test("dev launches all or only selected Workers with exact native commands and server persistence options", async () => {
  const terminalProbe: readonly [string, ...string[]] =
    process.platform === "darwin"
      ? ["script", "-q", "/dev/null", "true"]
      : ["script", "-q", "-e", "-c", "true", "/dev/null"];
  await withFixture([["temporal", "--version"], terminalProbe], async (fixture) => {
    const nativeRoot = join(fixture.project, nativePackage);
    const invocation = join(fixture.root, "invocation");
    const override = join(invocation, "override: worker.mjs");
    await cp(join(source, nativePackage), nativeRoot, { recursive: true });
    await mkdir(invocation);
    await cp(join(source, "override-worker.mjs"), override);
    await chmod(override, 0o755);
    const installed = await fixture.run("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: nativeRoot,
    });
    expect(installed.code).toBe(0);

    const authored = await temporalEndpoint();
    const managed = await temporalEndpoint();
    const connectionEnv = { TEMPORAL_ADDRESS: "127.0.0.1:1", TEMPORAL_NAMESPACE: "authored-env" };
    const options = { cwd: invocation, env: connectionEnv };
    const serverArgs = ["server", "start-dev", ...managed.serverArgs];
    const devArgs = ["dev", fixture.project];
    const settings = join(nativeRoot, "worker-settings.json");
    await writeFile(
      settings,
      JSON.stringify({ address: authored.address, namespace: authored.namespace }),
    );
    const authoredServer = fixture.start("temporal", [
      "server",
      "start-dev",
      ...authored.serverArgs,
    ]);
    await withClient(authored, async () => {});
    const occupiedArgs = authored.serverArgs.map((arg) =>
      arg === authored.namespace ? managed.namespace : arg,
    );
    const occupied = await fixture.gsys([...devArgs, "--", ...occupiedArgs], options);
    expect(occupied).toMatchObject({ code: 1, signal: null });
    expect(occupied.stderr).toContain(
      `Managed Temporal address ${authored.address} is already in use`,
    );
    expect(occupied.stdout).not.toMatch(/^\[[^\]]+\] started PID /m);
    await withClient(authored, async () => {});

    // A prompt, missing Worker, or connection rewrite prevents these calls from completing.
    const defaults = [...devArgs, "--", ...managed.serverArgs];
    const checkDefaults = async (session: Session) => {
      await withClient(managed, async () => {
        expect(await temporalCommand(fixture, session)).toBe(serverArgs.join(" "));
      });
      await withClient(authored, async (client) => {
        const results = await Promise.all([runProbe(client, "alpha"), runProbe(client, "beta")]);
        const cwd = await workerDirectory(fixture.project);
        expect(results).toEqual(
          ["alpha", "beta"].map((name) => ({
            name,
            command: "inferred",
            argv: [],
            cwd,
            address: authored.address,
            namespace: authored.namespace,
            connectionEnv,
          })),
        );
      });
    };
    const piped = fixture.startGsys(defaults, options);
    await checkDefaults(piped);
    const pipedOutput = await stopSession(piped);
    expect(startedWorkers(pipedOutput)).toEqual(["alpha", "beta"]);
    for (const name of ["alpha", "beta"])
      expect(pipedOutput).toMatch(new RegExp(`^\\[${name}@[^\\]]+\\] launch probe ${name}$`, "m"));
    expect(startedWorkers(await inTerminal(fixture, defaults, options, checkDefaults))).toEqual([
      "alpha",
      "beta",
    ]);
    // Invalid startup selections report the exact rejected name without launching a Worker.
    for (const { args, error } of [
      { args: ["--worker", "alpha", "--worker", "missing"], error: "Unknown Worker: missing." },
      {
        args: ["--worker", "alpha", "--worker-arg=beta:unselected"],
        error: "Startup options target unselected Worker: beta.",
      },
    ]) {
      const invalid = fixture.startGsys(
        [...devArgs, ...args, "--", ...managed.serverArgs],
        options,
      );
      await expect.poll(() => invalid.output(), { timeout: 40_000 }).toContain(error);
      invalid.signal("SIGINT");
      const stopped = await invalid.wait(45_000);
      expect(stopped.stderr).toContain(error);
      expect(startedWorkers(stopped.stdout)).toEqual([]);
    }

    const missingPath = join(invocation, "missing worker");
    const missing = fixture.startGsys(
      [
        ...devArgs,
        "--worker",
        "alpha",
        `--worker-exec=alpha:${missingPath}`,
        "--",
        ...managed.serverArgs,
      ],
      options,
    );
    await expect.poll(missing.output, { timeout: 40_000 }).toContain(`spawn ${missingPath} ENOENT`);
    missing.signal("SIGINT");
    const failed = await missing.wait(45_000);
    expect(failed).toMatchObject({ code: 1, signal: null });
    expect(failed.stderr).toContain(`spawn ${missingPath} ENOENT`);
    expect(startedWorkers(failed.stdout)).toEqual([]);
    await expectClosedPort(managed.port);
    await withClient(authored, async () => {});
    await authoredServer.stop();

    // A dropped or rewritten database path loses a completed execution across owned restarts.
    await writeFile(
      settings,
      JSON.stringify({ address: managed.address, namespace: managed.namespace }),
    );
    await mkdir(join(invocation, "state files"));
    const database = "./state files/session: temporal.sqlite";
    const databasePath = join(invocation, database);
    const persisted = ["--", ...managed.serverArgs, "--db-filename", database];
    const shellMarker = join(invocation, "evaluated-shell-argument");
    const argv = [
      "space in argument",
      "colon:a:b",
      "",
      "雪と🧪",
      `$(touch '${shellMarker}')`,
      "|;&*<>\"'",
    ];
    const betaArg = "beta:only";
    const first = fixture.startGsys(
      [
        ...devArgs,
        "--worker",
        "alpha",
        "--worker",
        "beta",
        "--worker",
        "alpha",
        `--worker-exec=alpha:${override}`,
        ...argv.map((arg) => `--worker-arg=alpha:${arg}`),
        `--worker-arg=beta:${betaArg}`,
        ...persisted,
      ],
      options,
    );
    const workflowId = randomUUID();
    const before = await withClient(managed, async (client) => {
      expect(await temporalCommand(fixture, first)).toBe(
        [...serverArgs, "--db-filename", database].join(" "),
      );
      const [alpha, beta] = await Promise.all([
        runProbe(client, "alpha", workflowId),
        runProbe(client, "beta"),
      ]);
      const cwd = await workerDirectory(fixture.project);
      expect(alpha).toEqual({
        name: "alpha",
        command: "override",
        argv,
        cwd,
        address: managed.address,
        namespace: managed.namespace,
        connectionEnv,
      });
      expect(beta).toMatchObject({ name: "beta", command: "inferred", argv: [betaArg], cwd });
      return alpha;
    });
    expect(startedWorkers(await stopSession(first))).toEqual(["alpha", "beta"]);
    await expect(access(shellMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(databasePath)).size).toBeGreaterThan(0);

    const second = fixture.startGsys([...devArgs, "--worker", "alpha", ...persisted], options);
    await withClient(managed, async (client) => {
      await expect(client.getHandle(workflowId).result()).resolves.toEqual(before);
      await expect(runProbe(client, "alpha")).resolves.toMatchObject({ name: "alpha", argv: [] });
    });
    expect(startedWorkers(await stopSession(second))).toEqual(["alpha"]);
    expect((await stat(databasePath)).size).toBeGreaterThan(0);
  });
}, 720_000);
