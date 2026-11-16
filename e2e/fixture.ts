import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vitest";
import { monitorProcessGroups, signalProcess, supportsProcessGroups } from "./posix-processes.js";

const checkout = fileURLToPath(new URL("../", import.meta.url));
const cliPackage = join(checkout, "packages", "genesys");
const commandTimeout = 120_000;
export const posixTest = test.skipIf(!supportsProcessGroups);

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  trackGroups?: boolean;
}

function startCommand(
  executable: string,
  args: readonly string[],
  { cwd, env, timeout = commandTimeout, trackGroups }: CommandOptions,
) {
  const command = [executable, ...args].join(" ");
  const batch = process.platform === "win32" && /^(npm|pnpm)$|\.cmd$/i.test(executable);
  if (batch && [executable, ...args].some((value) => /["\r\n]/.test(value)))
    throw new Error(
      "Windows package commands cannot pass quotes or newlines through a batch shim.",
    );
  const batchArgs = [executable, ...args].map((value, index) => [
    `GENESYS_E2E_CMD_ARG_${index}`,
    value,
  ]);
  const child = spawn(
    batch ? (process.env.ComSpec ?? "cmd.exe") : executable,
    // Keep percent signs in paths literal during cmd.exe's expansion.
    batch
      ? ["/d", "/s", "/v:off", "/c", `"${batchArgs.map(([name]) => `"%${name}%"`).join(" ")}"`]
      : args,
    {
      cwd,
      env: {
        ...process.env,
        NODE_PATH: "",
        ...env,
        ...(batch ? Object.fromEntries(batchArgs) : {}),
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: batch,
    },
  );
  let stdout = "";
  let stderr = "";
  let error: Error | undefined;
  let closed = false;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.once("error", (cause) => (error = cause));
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    }),
  );

  const output = () =>
    `${command}\nstdout:\n${stdout.slice(-8_000)}\nstderr:\n${stderr.slice(-8_000)}`;
  const livePid = () =>
    child.exitCode === null && child.signalCode === null ? child.pid : undefined;
  const groups = trackGroups && supportsProcessGroups ? monitorProcessGroups(livePid) : undefined;
  let stopping: Promise<void> | undefined;

  async function waitForClose(limit: number) {
    const timer = new AbortController();
    try {
      return await Promise.race([
        completed,
        delay(limit, undefined, { signal: timer.signal }).then(() => {
          throw new Error(`Command timed out after ${limit} ms:\n${output()}`);
        }),
      ]);
    } finally {
      timer.abort();
    }
  }

  async function wait(limit = timeout) {
    const exit = await waitForClose(limit);
    if (error) throw new Error(`Cannot launch ${executable}: ${error.message}`, { cause: error });
    return { ...exit, stdout, stderr };
  }

  function signal(signal: NodeJS.Signals) {
    if (livePid() !== undefined) child.kill(signal);
  }

  async function signalDescendant(pid: number, signal: NodeJS.Signals) {
    const snapshot = await groups?.current();
    if (!snapshot?.descendants.has(pid))
      throw new Error(`Cannot verify that PID ${pid} is a live descendant of ${command}.`);
    signalProcess(pid, signal);
  }

  async function stopCommand() {
    if (!closed) {
      signal("SIGINT");
      await waitForClose(45_000).catch(async () => {
        signal("SIGINT");
        await waitForClose(10_000).catch(() => {});
      });
    }

    try {
      if (groups) {
        const snapshot = await groups.current().catch((cause: unknown) => {
          signal("SIGKILL");
          throw new Error(`Cannot verify process group cleanup for ${command}.`, { cause });
        });
        const pid = child.pid;
        for (const group of snapshot.owned.keys())
          if (group !== pid) signalProcess(-group, "SIGKILL");
        if (pid !== undefined && snapshot.owned.has(pid)) signalProcess(-pid, "SIGKILL");
        else signal("SIGKILL");

        if (!closed) await waitForClose(5_000);
        const deadline = Date.now() + 5_000;
        let remaining = await groups.current();
        while (remaining.owned.size && Date.now() < deadline) {
          await delay(100);
          remaining = await groups.current();
        }
        const reported = [
          ...stdout.matchAll(/^(?:\[[^\]]+\] started PID (\d+);|TTY supervisor PID (\d+))/gm),
        ].map(([, managed, terminal]) => Number(managed ?? terminal));
        const unresolved = groups.uncertainGroups(remaining, reported);
        if (remaining.owned.size || unresolved.length)
          throw new Error(
            `Process groups still live for ${command}. Owned: ${[...remaining.owned.keys()]}; ownership unverified: ${unresolved}.`,
          );
      } else if (!closed) {
        const pid = livePid();
        if (pid !== undefined && process.platform !== "win32") signalProcess(-pid, "SIGKILL");
        else signal("SIGKILL");
        await waitForClose(5_000);
      }
    } finally {
      groups?.stop();
    }
  }

  return {
    get pid() {
      return child.pid;
    },
    output,
    signal,
    signalDescendant,
    stop: () => (stopping ??= stopCommand()),
    wait,
  };
}

async function prepareFixture(
  root: string,
  tools: readonly (readonly [string, ...string[]])[],
  versions: Record<string, string>,
  startProcess: typeof startCommand,
) {
  const project = join(root, "project");
  const consumer = join(root, "consumer");
  function start(executable: string, args: readonly string[], options: CommandOptions = {}) {
    return startProcess(executable, args, { cwd: project, ...options });
  }

  async function run(executable: string, args: readonly string[], options?: CommandOptions) {
    return start(executable, args, options).wait();
  }

  async function required(executable: string, args: readonly string[], options?: CommandOptions) {
    const command = start(executable, args, options);
    const result = await command.wait();
    if (result.code !== 0)
      throw new Error(`Command failed (${result.signal ?? result.code}):\n${command.output()}`);
    return result.stdout.trim();
  }

  const [checkoutPath, fixturePath] = await Promise.all([realpath(checkout), realpath(root)]);
  const location = relative(checkoutPath, fixturePath);
  if (!isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`))
    throw new Error("Set the temporary directory outside the Genesys checkout.");
  await Promise.all([mkdir(project), mkdir(consumer)]);
  await writeFile(join(consumer, "package.json"), '{"private":true}\n');
  const prerequisites: readonly (readonly [string, ...string[]])[] = [
    ["npm", "--version"],
    ["pnpm", "--version"],
    ...tools,
  ];
  for (const [tool, ...args] of prerequisites) {
    try {
      versions[tool] = await required(tool, args, { cwd: cliPackage, timeout: 10_000 });
    } catch (error) {
      throw new Error(`Required local tool failed: ${tool} ${args.join(" ")}`, { cause: error });
    }
  }

  const suppliedTarball = process.env.GSYS_TEST_TARBALL;
  let tarball: string;
  if (suppliedTarball === undefined) {
    const filename = await required(
      "npm",
      ["pack", cliPackage, "--pack-destination", root, "--silent"],
      { cwd: consumer },
    );
    tarball = join(root, filename);
  } else {
    if (!isAbsolute(suppliedTarball)) {
      throw new Error("GSYS_TEST_TARBALL must be an absolute path.");
    }
    tarball = join(root, "genesys-cli.tgz");
    await copyFile(suppliedTarball, tarball);
  }
  await required(
    "npm",
    ["install", "--no-audit", "--no-fund", "--no-save", "--package-lock=false", tarball],
    { cwd: consumer },
  );
  const installed = join(consumer, "node_modules", "@genesys", "cli");
  const executable = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "gsys.cmd" : "gsys",
  );
  versions.gsys = await required(executable, ["--version"]);
  const startGsys = (args: readonly string[], options?: CommandOptions) =>
    process.platform === "win32"
      ? start(process.execPath, [join(installed, "dist", "cli.js"), ...args], options)
      : start(executable, args, { ...options, trackGroups: args[0] === "dev" });

  return {
    root,
    project,
    executable,
    installed,
    versions,
    tarball,
    run,
    start,
    gsys: (args: readonly string[], options?: CommandOptions) => startGsys(args, options).wait(),
    startGsys,
  };
}

export async function withFixture(
  tools: readonly (readonly [string, ...string[]])[],
  runTest: (fixture: Awaited<ReturnType<typeof prepareFixture>>) => Promise<void>,
) {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error(`E2E tests require Node.js 24 or later. The runner uses ${process.version}.`);
  const root = mkdtemp(join(tmpdir(), "genesys-e2e-"));
  const commands: ReturnType<typeof startCommand>[] = [];
  const versions: Record<string, string> = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
  let cleanup: Promise<void> | undefined;
  let finished = false;

  function stopFixture() {
    return (cleanup ??= (async () => {
      const stopped = await Promise.allSettled(commands.map((command) => command.stop()));
      const failures = stopped.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      try {
        await rm(await root, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length) throw new AggregateError(failures, "Fixture cleanup failed");
    })());
  }

  function diagnostics() {
    process.stderr.write(
      `${[JSON.stringify(versions), ...commands.map((command) => command.output())].join("\n\n")}\n`,
    );
  }

  onTestFinished(async () => {
    if (finished) return;
    try {
      await stopFixture();
    } finally {
      diagnostics();
    }
  }, 120_000);

  const failures: unknown[] = [];
  try {
    const fixture = await prepareFixture(
      await root,
      tools,
      versions,
      (executable, args, options) => {
        if (cleanup) throw new Error("Cannot launch a command after fixture cleanup starts.");
        const command = startCommand(executable, args, options);
        commands.push(command);
        return command;
      },
    );
    await runTest(fixture);
  } catch (error) {
    failures.push(error);
  }
  await stopFixture().catch((error: unknown) => failures.push(error));
  finished = true;
  if (failures.length) {
    diagnostics();
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "Case and fixture cleanup failed");
  }
}

export async function expectClosedPort(port: number) {
  await expect(
    new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
      socket.setTimeout(2_000, () => socket.destroy(new Error("Timed out checking listener")));
    }),
  ).rejects.toMatchObject({ code: "ECONNREFUSED" });
}

export async function temporalEndpoint() {
  const server = createServer();
  const host = "127.0.0.1";
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== "string") resolve(address.port);
        else reject(new Error("Could not allocate a loopback port"));
      });
    });
  });
  const address = `${host}:${port}`;
  const namespace = `gsys-${randomUUID()}`;
  return {
    address,
    namespace,
    port,
    serverArgs: [
      "--ip",
      host,
      "--port",
      String(port),
      "--headless",
      "--namespace",
      namespace,
      "--disable-config-env",
      "--disable-config-file",
    ],
    workerEnv: { TEMPORAL_ADDRESS: address, TEMPORAL_NAMESPACE: namespace },
  };
}
