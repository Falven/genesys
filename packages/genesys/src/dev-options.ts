import { parseArgs } from "node:util";
import type { PublishedBuild } from "./build.js";
import type { WorkerProgram } from "./contracts.js";

export interface WorkerStartupOptions {
  workerNames?: readonly string[];
  workerExecutables?: ReadonlyMap<string, string>;
  workerArgs?: ReadonlyMap<string, readonly string[]>;
}

export interface DevStartupOptions extends WorkerStartupOptions {
  serverArgs?: readonly string[];
  startupConfigured?: boolean;
}

export function hasStartupOptions(options: DevStartupOptions): boolean {
  return Boolean(
    options.startupConfigured ||
    options.workerNames?.length ||
    options.workerExecutables?.size ||
    options.workerArgs?.size ||
    options.serverArgs?.length,
  );
}

function targetValue(value: string, option: string): [string, string] {
  const colon = value.indexOf(":");
  if (colon < 1) throw new Error(`${option} requires <name>:<value>.`);
  return [value.slice(0, colon), value.slice(colon + 1)];
}

export function parseDevArgs(args: readonly string[]): {
  projectPath: string;
  options: DevStartupOptions;
} {
  const separator = args.indexOf("--");
  const serverArgs = separator < 0 ? [] : args.slice(separator + 1);
  const { values, positionals } = parseArgs({
    args: separator < 0 ? [...args] : args.slice(0, separator),
    allowPositionals: true,
    options: {
      worker: { type: "string", multiple: true },
      "worker-exec": { type: "string", multiple: true },
      "worker-arg": { type: "string", multiple: true },
    },
  });
  if (positionals.length > 1) throw new Error("Dev accepts one project directory.");
  const workerNames = values.worker ?? [];
  if (workerNames.some((name) => !name)) throw new Error("--worker requires a Worker name.");
  const workerExecutables = new Map<string, string>();
  for (const value of values["worker-exec"] ?? []) {
    const [name, executable] = targetValue(value, "--worker-exec");
    if (!executable) throw new Error(`--worker-exec requires an executable for Worker ${name}.`);
    workerExecutables.set(name, executable);
  }
  const workerArgs = new Map<string, string[]>();
  for (const value of values["worker-arg"] ?? []) {
    const [name, argument] = targetValue(value, "--worker-arg");
    const argumentsForWorker = workerArgs.get(name) ?? [];
    argumentsForWorker.push(argument);
    workerArgs.set(name, argumentsForWorker);
  }
  const options = { workerNames, workerExecutables, workerArgs, serverArgs };
  return {
    projectPath: positionals[0] ?? process.cwd(),
    options: { ...options, startupConfigured: hasStartupOptions(options) },
  };
}

export function selectWorkers(
  build: PublishedBuild,
  options: WorkerStartupOptions,
): WorkerProgram[] {
  const known = new Set(build.workers.map((worker) => worker.name));
  const selected = new Set(options.workerNames?.length ? options.workerNames : known);
  for (const name of selected) if (!known.has(name)) throw new Error(`Unknown Worker: ${name}.`);
  for (const name of [
    ...(options.workerExecutables?.keys() ?? []),
    ...(options.workerArgs?.keys() ?? []),
  ]) {
    if (!known.has(name)) throw new Error(`Unknown Worker: ${name}.`);
    if (!selected.has(name)) throw new Error(`Startup options target unselected Worker: ${name}.`);
  }
  return build.workers
    .filter((worker) => selected.has(worker.name))
    .map((worker) => {
      const executable = options.workerExecutables?.get(worker.name);
      const args = options.workerArgs?.get(worker.name) ?? [];
      if (executable === undefined && !args.length) return worker;
      const { coverage: _coverage, ...configured } = worker;
      if (executable !== undefined) {
        const cwd = worker.start?.cwd ?? worker.workingDirectory;
        if (cwd === undefined)
          throw new Error(`Worker ${worker.name} has no known native working directory.`);
        return {
          ...configured,
          start: { ...worker.start, executable, args: [...args], cwd },
        };
      }
      if (!worker.start) throw new Error(`Worker ${worker.name} has no native start command.`);
      return {
        ...configured,
        start: {
          ...worker.start,
          args: [...worker.start.args, ...args],
        },
      };
    });
}
