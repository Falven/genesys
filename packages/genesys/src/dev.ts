import { resolve, relative, isAbsolute, sep, dirname, basename } from "node:path";
import { createConnection } from "node:net";
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { startSupervisor, tryReuseSupervisor } from "./dev-reuse.js";
import type { PublishedBuild } from "./build.js";
import { DevelopmentReplacement } from "./dev-replacement.js";
import { checkGoLaunch, nativeRetirement, type NativeCoverage } from "./native-retirement.js";
import { hasStartupOptions, selectWorkers, type DevStartupOptions } from "./dev-options.js";
import type { Command, WorkerProgram } from "./contracts.js";
import {
  managedConnection,
  observeWorker,
  queryTemporal,
  unknownObservation,
  type ManagedConnection,
  type WorkerObservation,
} from "./native-observation.js";
import {
  OwnedProcess,
  prepareProcessOwnership,
  requireProcessOwnership,
  type ProcessEvent,
} from "./owned-process.js";

export type DevEvent = ProcessEvent;
export interface WorkerGeneration {
  build: PublishedBuild;
  program: WorkerProgram;
  process: OwnedProcess;
  observation: WorkerObservation;
  coverage: NativeCoverage;
}
export interface DevSessionOptions extends DevStartupOptions {
  projectRoot: string;
  invocationDirectory: string;
  build?: PublishedBuild;
  workers?: readonly WorkerProgram[];
  log?: (event: DevEvent) => void;
}
export type RunDevOptions = Omit<
  DevSessionOptions,
  "projectRoot" | "build" | "workers" | "invocationDirectory"
> & {
  invocationDirectory?: string;
};

function print(event: DevEvent): void {
  const destination =
    event.kind === "stderr" || event.kind === "error" ? process.stderr : process.stdout;
  const lines = event.message.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) destination.write(`[${event.label}] ${line}\n`);
}

function launchCommand(build: PublishedBuild, program: WorkerProgram): Command {
  if (!program.start) throw new Error(`Worker ${program.name} has no native start command.`);
  const cwd = resolve(build.root, program.start.cwd);
  const part = relative(build.root, cwd);
  if (isAbsolute(part) || part === ".." || part.startsWith(`..${sep}`))
    throw new Error(`Worker ${program.name} working directory escapes its versioned build: ${cwd}`);
  return { ...program.start, args: [...program.start.args], cwd };
}

export class DevSession {
  readonly workers: WorkerGeneration[] = [];
  readonly temporal: OwnedProcess;
  readonly connection: ManagedConnection;
  readonly done: Promise<void>;
  readonly projectRoot: string;
  runtimeFiles: readonly string[] = [];
  private readonly runtimeDatabases: readonly string[];
  private readonly completed = Promise.withResolvers<void>();
  private readonly listeners = new Set<(event: DevEvent) => void>();
  private readonly observationStop = new AbortController();
  private observationInFlight: Promise<void> | undefined;
  private stopping = false;
  private replacement: DevelopmentReplacement | undefined;
  private forced = false;
  private readonly interrupt = (): void => {
    void this.shutdown(this.stopping);
  };

  constructor(options: DevSessionOptions) {
    requireProcessOwnership();
    this.projectRoot = options.projectRoot;
    const serverArgs = options.serverArgs ?? [];
    this.runtimeDatabases = serverArgs.flatMap((argument, index) => {
      const filename =
        argument === "--db-filename" || argument === "-f"
          ? serverArgs[index + 1]
          : argument.startsWith("--db-filename=")
            ? argument.slice("--db-filename=".length)
            : argument.startsWith("-f=")
              ? argument.slice(3)
              : argument.startsWith("-f")
                ? argument.slice(2)
                : undefined;
      return filename ? [resolve(options.invocationDirectory, filename)] : [];
    });
    this.done = this.completed.promise;
    void this.done.catch(() => {});
    this.listeners.add(options.log ?? print);
    this.connection = managedConnection(options.serverArgs ?? []);
    this.temporal = new OwnedProcess(
      "temporal",
      {
        executable: "temporal",
        args: ["server", "start-dev", ...(options.serverArgs ?? [])],
        cwd: options.invocationDirectory,
      },
      (event) => this.report(event),
    );
    process.on("SIGINT", this.interrupt);
    process.on("SIGTERM", this.interrupt);
    void this.temporal.exited.then(() => {
      if (!this.stopping) {
        process.exitCode = 1;
        this.report({
          kind: "error",
          label: "temporal",
          message: "Managed server exited; stopping owned Workers.",
        });
        void this.shutdown();
      }
    });
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  onEvent(listener: (event: DevEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  report(event: DevEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  watchWorkers(options: DevStartupOptions): void {
    if (this.stopping) return;
    this.replacement = new DevelopmentReplacement(
      this,
      (build) => selectWorkers(build, options),
      nativeRetirement(this.connection),
    );
  }

  async startWorkers(
    build: PublishedBuild,
    programs: readonly WorkerProgram[] = build.workers,
  ): Promise<WorkerGeneration[]> {
    if (this.stopping) throw new Error("The development session is stopping.");
    const commands = programs.map((program) => ({
      program,
      command: launchCommand(build, program),
    }));
    const generations: WorkerGeneration[] = [];
    for (const { program, command } of commands) {
      if (this.stopping) break;
      const launchCoverage = await checkGoLaunch(program, command);
      if (this.stopping) break;
      const child = new OwnedProcess(`${program.name}@${build.id}`, command, (event) =>
        this.report(event),
      );
      const generation: WorkerGeneration = {
        build,
        program,
        process: child,
        coverage: { state: "unknown", reason: launchCoverage.reason },
        observation: unknownObservation(
          "Waiting for attributed native heartbeat and successful polling. Startup metadata alone does not establish readiness.",
        ),
      };
      this.workers.push(generation);
      generations.push(generation);
      this.report({ kind: "status", label: child.label, message: generation.observation.reason });
      void child.exited.then(() => {
        generation.observation = {
          ...unknownObservation("Worker process exited."),
          readiness: "failed",
        };
        if (!this.stopping && !child.shutdownRequested) {
          process.exitCode = 1;
          this.report({
            kind: "error",
            label: child.label,
            message:
              "Worker process exited; its build remains retained until the owned process group exits.",
          });
        }
      });
      await child.started.catch(() => {
        process.exitCode = 1;
      });
      if (launchCoverage.proof && child.state === "running") {
        try {
          const members = await child.liveProcesses();
          const native = members.find((member) => member.pid === child.nativePid);
          if (members.length === 1 && native)
            generation.coverage = {
              state: "known",
              proof: launchCoverage.proof,
              pid: native.pid,
              startedAt: native.startedAt,
            };
          else
            generation.coverage = {
              state: "unknown",
              reason: "Direct Go process identity is not the sole owned native process.",
            };
        } catch (error) {
          generation.coverage = {
            state: "unknown",
            reason: `Native process binding unavailable: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }
    return generations;
  }

  async observe(): Promise<void> {
    if (this.stopping) return;
    if (this.observationInFlight) return this.observationInFlight;
    const observation = async (): Promise<void> => {
      for (const worker of this.workers) {
        if (this.stopping) return;
        const previous = worker.observation;
        const current = await observeWorker(
          this.connection,
          worker.process,
          this.observationStop.signal,
          previous,
        );
        if (this.stopping) return;
        worker.observation = current;
        const summary = (value: WorkerObservation): string =>
          JSON.stringify({
            readiness: value.readiness,
            reason: value.reason,
            instances: value.instances.map((instance) => [
              instance.namespace,
              instance.instanceKey,
              instance.readiness,
              instance.reason,
            ]),
          });
        if (summary(previous) !== summary(current))
          this.report({
            kind: "status",
            label: worker.process.label,
            message: `${current.readiness}: ${current.reason}${current.instances.map((instance) => `\n${instance.namespace}/${instance.instanceKey} queue=${instance.taskQueue} PID=${instance.pid}: ${instance.readiness}`).join("")}`,
          });
      }
    };
    this.observationInFlight = observation();
    try {
      await this.observationInFlight;
      await this.replacement?.observe();
    } finally {
      this.observationInFlight = undefined;
    }
  }

  private async resolveRuntimeFiles(): Promise<void> {
    const canonical = async (path: string): Promise<string> => {
      try {
        return await realpath(path);
      } catch (error) {
        if (
          !(error instanceof Error && "code" in error && error.code === "ENOENT") ||
          dirname(path) === path
        )
          throw error;
        return resolve(await canonical(dirname(path)), basename(path));
      }
    };
    const files = new Set<string>();
    for (const path of this.runtimeDatabases) {
      for (const base of [path, await canonical(path)]) {
        for (const suffix of ["", "-wal", "-shm", "-journal"]) files.add(base + suffix);
      }
    }
    this.runtimeFiles = [...files];
  }

  async ready(): Promise<void> {
    await this.temporal.started;
    await this.resolveRuntimeFiles();
    if (this.connection.state === "unknown") {
      this.report({
        kind: "status",
        label: "temporal",
        message: `Service readiness unknown: ${this.connection.reason}`,
      });
      return;
    }
    let failure = "No response.";
    for (let attempt = 0; attempt < 15 && !this.stopping; attempt++) {
      try {
        const health = await queryTemporal(
          this.connection,
          "default",
          ["operator", "cluster", "health"],
          this.observationStop.signal,
        );
        if (
          !health ||
          typeof health !== "object" ||
          !("status" in health) ||
          health.status !== "SERVING"
        )
          throw new Error("Native health check did not report SERVING.");
        if (this.temporal.state !== "running" || this.stopping)
          throw new Error("Managed server exited during startup.");
        await this.resolveRuntimeFiles();
        this.report({
          kind: "status",
          label: "temporal",
          message: `Service health observed at ${this.connection.address}; Worker connections remain authored native settings.`,
        });
        return;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (!this.stopping) await delay(500);
      }
    }
    if (this.stopping) return;
    throw new Error(`Managed Temporal did not become available: ${failure}`);
  }

  async monitor(): Promise<void> {
    while (!this.stopping) {
      await this.observe();
      await delay(5_000, undefined, { signal: this.observationStop.signal }).catch(() => {});
    }
  }

  shutdown(force = false): Promise<void> {
    if (force && !this.forced) {
      this.forced = true;
      this.report({
        kind: "status",
        label: "gsys",
        message: "Forcing termination of owned process groups.",
      });
      void this.replacement?.stop(true);
      for (const child of [...this.workers.map((worker) => worker.process), this.temporal])
        void child.signal(true).catch((error: unknown) => this.signalError(child, error));
    }
    if (!this.stopping) {
      this.stopping = true;
      this.observationStop.abort();
      void this.stop().catch((error: unknown) => {
        process.exitCode = 1;
        process.off("SIGINT", this.interrupt);
        process.off("SIGTERM", this.interrupt);
        this.completed.reject(error);
      });
    }
    return this.done;
  }

  private signalError(child: OwnedProcess, error: unknown): void {
    this.report({
      kind: "error",
      label: child.label,
      message: `Cannot signal owned processes: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  private async stop(): Promise<void> {
    this.report({
      kind: "status",
      label: "gsys",
      message:
        "Requesting native Worker shutdown. Waiting without a deadline; interrupt again to force owned processes.",
    });
    const replacementStopped = this.replacement?.stop(this.forced);
    const stopped = await Promise.allSettled([
      ...this.workers.map(async ({ process: child }) => {
        await child.signal(this.forced).catch((error: unknown) => this.signalError(child, error));
        await child.done;
      }),
      replacementStopped,
    ]);
    const failures = stopped.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (!failures.length) await this.replacement?.finishCleanup();
    await this.temporal
      .signal(this.forced)
      .catch((error: unknown) => this.signalError(this.temporal, error));
    await this.temporal.done;
    await this.observationInFlight;
    if (failures.length)
      throw new AggregateError(
        failures,
        "Owned process shutdown failed; retained builds require manual inspection.",
      );
    process.off("SIGINT", this.interrupt);
    process.off("SIGTERM", this.interrupt);
    this.completed.resolve();
  }
}

async function requireUnusedEndpoint(connection: ManagedConnection): Promise<void> {
  if (connection.state !== "known") return;
  const endpoint = new URL(`tcp://${connection.address}`);
  const listening = await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({
      host: endpoint.hostname.replace(/^\[|\]$/g, ""),
      port: Number(endpoint.port),
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.setTimeout(1_500, () => {
      socket.destroy();
      reject(new Error(`Cannot establish whether ${connection.address} is unused.`));
    });
  });
  if (listening)
    throw new Error(
      `Managed Temporal address ${connection.address} is already in use. No existing service was changed.`,
    );
}

export async function startDevSession(options: DevSessionOptions): Promise<DevSession> {
  await prepareProcessOwnership();
  await requireUnusedEndpoint(managedConnection(options.serverArgs ?? []));
  const session = new DevSession(options);
  try {
    await session.ready();
    if (options.build && !session.isStopping)
      await session.startWorkers(
        options.build,
        options.workers ?? selectWorkers(options.build, options),
      );
    void session.monitor().catch((error: unknown) =>
      session.report({
        kind: "error",
        label: "gsys",
        message: `Native observation stopped: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
    return session;
  } catch (error) {
    await session.shutdown();
    throw error;
  }
}

export async function runDev(projectPath: string, options: RunDevOptions = {}): Promise<void> {
  const projectRoot = await realpath(resolve(projectPath));
  if (await tryReuseSupervisor(projectRoot, hasStartupOptions(options))) return;
  const session = await startDevSession({
    ...options,
    projectRoot,
    invocationDirectory: options.invocationDirectory ?? process.cwd(),
  });
  let supervisor: Awaited<ReturnType<typeof startSupervisor>> | undefined;
  try {
    if (session.isStopping) return await session.done;
    supervisor = await startSupervisor(session);
    session.watchWorkers(options);
    await session.done;
  } finally {
    try {
      await session.shutdown();
    } finally {
      await supervisor?.close();
    }
  }
}
