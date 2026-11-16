import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownBuild, type PublishedBuild, type BuildInput } from "./build.js";
import { isGoWorkerCoverage, languages, type Command, type WorkerProgram } from "./contracts.js";
import { OwnedProcess, type ProcessEvent } from "./owned-process.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((part: unknown) => typeof part === "string");
}
function command(value: unknown): value is Command {
  return (
    record(value) &&
    typeof value.executable === "string" &&
    typeof value.cwd === "string" &&
    strings(value.args) &&
    (value.env === undefined ||
      (record(value.env) && Object.values(value.env).every((part) => typeof part === "string")))
  );
}
function worker(value: unknown): value is WorkerProgram {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    languages.some((language) => value.language === language) &&
    typeof value.packageId === "string" &&
    record(value.source) &&
    typeof value.source.path === "string" &&
    (value.source.line === undefined || typeof value.source.line === "number") &&
    (value.source.column === undefined || typeof value.source.column === "number") &&
    (value.build === undefined || (Array.isArray(value.build) && value.build.every(command))) &&
    (value.start === undefined || command(value.start)) &&
    (value.workingDirectory === undefined || typeof value.workingDirectory === "string") &&
    (value.coverage === undefined || isGoWorkerCoverage(value.coverage)) &&
    record(value.readiness) &&
    ["supported", "unavailable"].includes(String(value.readiness.state)) &&
    typeof value.readiness.description === "string" &&
    (value.readiness.evidence === undefined || strings(value.readiness.evidence))
  );
}
function input(value: unknown): value is BuildInput {
  if (!record(value) || typeof value.path !== "string") return false;
  if (value.kind === "symlink") return typeof value.target === "string";
  if (value.kind === "directory") return typeof value.mode === "number";
  return (
    value.kind === "file" &&
    typeof value.sha256 === "string" &&
    typeof value.size === "number" &&
    typeof value.mode === "number"
  );
}
function publishedBuild(value: unknown): value is PublishedBuild {
  return (
    record(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.root === "string" &&
    typeof value.projectRoot === "string" &&
    typeof value.manifestPath === "string" &&
    typeof value.metadataPath === "string" &&
    Array.isArray(value.workers) &&
    value.workers.every(worker) &&
    Array.isArray(value.inputs) &&
    value.inputs.every(input) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(
      (artifact: unknown) =>
        record(artifact) &&
        typeof artifact.path === "string" &&
        ["registration", "source", "metadata", "native-output"].includes(String(artifact.kind)) &&
        input(artifact.entry),
    ) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool: unknown) =>
        record(tool) &&
        typeof tool.executable === "string" &&
        typeof tool.cwd === "string" &&
        typeof tool.version === "string",
    )
  );
}

/** Isolate every native analysis/build descendant in the session's owned group. */
export async function startBuildJob(
  projectRoot: string,
  report: (event: ProcessEvent) => void,
  excludedFiles: readonly string[] = [],
): Promise<{ process: OwnedProcess; result: Promise<PublishedBuild> }> {
  const id = randomUUID();
  const jobs = join(projectRoot, ".gsys", "build-jobs");
  await mkdir(jobs, { recursive: true });
  const resultPath = join(jobs, `${id}.json`);
  const child = new OwnedProcess(
    `build@${id}`,
    {
      executable: process.execPath,
      args: [
        fileURLToPath(new URL("./build-job.js", import.meta.url)),
        projectRoot,
        id,
        resultPath,
        ...excludedFiles,
      ],
      cwd: projectRoot,
    },
    report,
  );
  let completed = false;
  const result = (async (): Promise<PublishedBuild> => {
    try {
      await child.started;
      const exit = await child.exited;
      await child.done;
      if (exit.code !== 0 || child.shutdownRequested)
        throw new Error(
          `Native build did not complete (${exit.signal ?? exit.code ?? "cancelled"}).`,
        );
      const value: unknown = JSON.parse(await readFile(resultPath, "utf8"));
      if (!publishedBuild(value) || value.id !== id || value.projectRoot !== projectRoot)
        throw new Error("Invalid result from owned build process.");
      await ownBuild(value);
      completed = true;
      return value;
    } finally {
      await child.done;
      await rm(resultPath, { force: true });
      // An interrupted child cannot run its finally block. Preserve the published pointer.
      const manifest = await readFile(
        join(projectRoot, ".gsys", "compile", "manifest.json"),
        "utf8",
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "null";
        throw error;
      });
      const current: unknown = JSON.parse(manifest);
      if (
        !completed &&
        (current === null ||
          (record(current) && typeof current.id === "string" && current.id !== id))
      )
        await rm(join(projectRoot, ".gsys", "compile", "builds", id), {
          recursive: true,
          force: true,
        });
      for (const name of [`.manifest-${id}.json`, `.metadata-${id}.json`])
        await rm(join(projectRoot, ".gsys", "compile", name), { force: true });
    }
  })();
  void result.catch(() => {});
  return { process: child, result };
}
