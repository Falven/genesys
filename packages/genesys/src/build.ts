import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { commandEnvironment, windowsCommand } from "./windows-command.js";
import type { Command, GeneratedArtifact, WorkerProgram } from "./contracts.js";
import { proveGoWorker } from "./sdk/go.js";
import { writeDiscovery } from "./discovery.js";
import {
  analyzeProject,
  emitProject,
  runNativeCommand,
  writeArtifacts,
  type AnalyzedProject,
} from "./sdk.js";

export type BuildInput =
  | { path: string; kind: "file"; sha256: string; size: number; mode: number }
  | { path: string; kind: "symlink"; target: string }
  | { path: string; kind: "directory"; mode: number };

export interface BuildArtifact {
  path: string;
  kind: GeneratedArtifact["kind"] | "native-output";
  entry: BuildInput;
}

export interface BuildTool {
  executable: string;
  cwd: string;
  version: string;
}

export interface PublishedBuild {
  schemaVersion: 1;
  id: string;
  /** Authored project; commands must use root instead. */
  projectRoot: string;
  /** Stable absolute snapshot path. Never rename a built native environment. */
  root: string;
  manifestPath: string;
  metadataPath: string;
  workers: WorkerProgram[];
  artifacts: BuildArtifact[];
  inputs: BuildInput[];
  tools: BuildTool[];
}

export type BuildResult =
  | { state: "published"; project: AnalyzedProject; build: PublishedBuild }
  | { state: "failed"; project: AnalyzedProject };

const execute = promisify(execFile);
const ownedBuilds = new WeakMap<
  PublishedBuild,
  { id: string; version: string; projectRoot: string }
>();
const excluded = new Set([".git", ".gsys", ".venv", "venv", "__pycache__"]);
const generatedHeader = /^(?:<\?php\r?\n)?(?:\/\/|#) (?:Code generated|Generated) by Genesys\./;
const slash = (path: string): string => path.split(sep).join("/");
export const runtimePathKey = (path: string): string =>
  process.platform === "win32" ? path.toLowerCase() : path;

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

async function hash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function directory(path: string): Promise<void> {
  await mkdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!(await lstat(path)).isDirectory())
    throw new Error(`Build directory is not a real directory: ${path}`);
}

/** Copy files, not hard links. Internal links are retargeted inside the snapshot. */
async function snapshot(
  source: string,
  destination: string,
  excludedFiles: ReadonlySet<string>,
  path = "",
): Promise<void> {
  const children = await readdir(join(source, path), { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (excluded.has(child.name)) continue;
    const part = join(path, child.name);
    const from = join(source, part);
    const to = join(destination, part);
    if (excludedFiles.has(runtimePathKey(from))) continue;
    if (child.isSymbolicLink()) {
      const target = await realpath(from);
      if (excludedFiles.has(runtimePathKey(target))) continue;
      const targetPart = relative(source, target);
      if (!inside(source, target) || targetPart.split(sep).some((segment) => excluded.has(segment)))
        throw new Error(
          `Cannot isolate symbolic link ${slash(part)} -> ${target}. Include its source within the project root or use a native dependency install.`,
        );
      const isDirectory = (await lstat(target)).isDirectory();
      const junction = process.platform === "win32" && isDirectory;
      await symlink(
        junction
          ? join(destination, targetPart)
          : relative(dirname(to), join(destination, targetPart)),
        to,
        junction ? "junction" : isDirectory ? "dir" : "file",
      );
    } else if (child.isDirectory()) {
      // A virtual environment contains absolute launch paths and must be rebuilt in place.
      const names = await readdir(from);
      if (names.includes("pyvenv.cfg")) continue;
      await mkdir(to);
      await snapshot(source, destination, excludedFiles, part);
      await chmod(to, (await lstat(from)).mode & 0o777);
    } else if (child.isFile()) {
      if (/\.(?:go|java|kt|cs|fs|vb|php|py|rb|rs|[cm]?[jt]sx?)$/.test(child.name)) {
        const content = await readFile(from, "utf8");
        if (generatedHeader.test(content)) continue;
      }
      await copyFile(from, to);
    } else {
      throw new Error(`Cannot snapshot special file: ${slash(part)}`);
    }
  }
}

async function inventory(root: string, authoredRoot?: string, path = ""): Promise<BuildInput[]> {
  const result: BuildInput[] = [];
  const children = await readdir(join(root, path), { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const part = join(path, child.name);
    const file = join(root, part);
    const name = slash(part);
    const stat = await lstat(file);
    if (child.isSymbolicLink()) {
      const target = await readlink(file);
      const resolved = await realpath(file);
      if (authoredRoot && inside(authoredRoot, resolved) && !inside(root, resolved))
        throw new Error(`Native build linked mutable authored source: ${name} -> ${resolved}`);
      result.push({ path: name, kind: "symlink", target });
    } else if (child.isDirectory()) {
      result.push({ path: name, kind: "directory", mode: stat.mode & 0o777 });
      result.push(...(await inventory(root, authoredRoot, part)));
    } else if (child.isFile()) {
      result.push({
        path: name,
        kind: "file",
        sha256: await hash(file),
        size: stat.size,
        mode: stat.mode & 0o777,
      });
    } else throw new Error(`Native build created a special file: ${name}`);
  }
  return result;
}

function nativeWorkingDirectory(directory: string, root: string): string {
  const cwd = resolve(root, directory);
  if (!inside(root, cwd)) throw new Error(`Native command working directory escapes build: ${cwd}`);
  return cwd;
}

function nativeCommand(command: Command, root: string, projectRoot: string): Command {
  const cwd = nativeWorkingDirectory(command.cwd, root);
  for (const path of [command.executable, ...command.args]) {
    if (isAbsolute(path) && inside(projectRoot, path) && !inside(root, path))
      throw new Error(`Native command refers to mutable authored source: ${path}`);
  }
  return { ...command, cwd };
}

async function toolVersions(commands: readonly Command[]): Promise<BuildTool[]> {
  const tools: BuildTool[] = [{ executable: process.execPath, cwd: "", version: process.version }];
  const seen = new Set<string>();
  // Probe native tools, never arbitrary authored executable programs.
  const known = new Set([
    "go",
    "java",
    "javac",
    "mvn",
    "mvnw",
    "gradle",
    "gradlew",
    "dotnet",
    "php",
    "composer",
    "rr",
    "python",
    "python3",
    "ruby",
    "bundle",
    "cargo",
    "rustc",
    "node",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "uv",
    "poetry",
  ]);
  for (const command of commands) {
    const name = basename(command.executable).replace(/\.(?:exe|cmd|bat)$/, "");
    const key = JSON.stringify([command.executable, command.cwd, command.env]);
    if (!known.has(name) || seen.has(key)) continue;
    seen.add(key);
    const args = name === "go" ? ["version"] : ["--version"];
    try {
      const native = windowsCommand({ ...command, args }, true);
      const { stdout, stderr } = await execute(native.executable, native.args, {
        cwd: native.cwd,
        env: commandEnvironment(native),
        windowsVerbatimArguments: native.windowsVerbatimArguments,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      tools.push({
        executable: command.executable,
        cwd: command.cwd,
        version: (stdout || stderr).trim(),
      });
    } catch (error) {
      throw new Error(`Cannot record native tool version: ${command.executable}`, { cause: error });
    }
  }
  return tools;
}

async function json(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

/** Publication commits one reference after all native commands succeed. */
export async function buildProject(
  projectPath: string,
  id: string = randomUUID(),
  excludedFiles: readonly string[] = [],
  nativeStdout: Parameters<typeof runNativeCommand>[1] = "inherit",
  mode: "production" | "development" = "production",
): Promise<BuildResult> {
  const projectRoot = await realpath(resolve(projectPath));
  const compile = join(projectRoot, ".gsys", "compile");
  for (const path of [join(projectRoot, ".gsys"), compile, join(compile, "builds")])
    await directory(path);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid internal build identifier.");
  const version = join(compile, "builds", id);
  const root = join(version, "project");
  await mkdir(version, { mode: 0o700 });
  await mkdir(root);
  let published = false;
  const temporary = join(compile, `.manifest-${id}.json`);
  const metadataTemporary = join(compile, `.metadata-${id}.json`);
  try {
    await snapshot(projectRoot, root, new Set(excludedFiles.map(runtimePathKey)));
    const inputs = await inventory(root);
    const project = await analyzeProject(root, mode === "production" ? mode : undefined);
    const emitted = await emitProject(project);
    project.diagnostics.push(...emitted.diagnostics);
    if (project.diagnostics.some((item) => item.severity === "error"))
      return { state: "failed", project };
    await writeArtifacts(root, emitted.artifacts);
    project.workers = project.workers.map((worker) => ({
      ...worker,
      ...(worker.workingDirectory !== undefined
        ? { workingDirectory: nativeWorkingDirectory(worker.workingDirectory, root) }
        : {}),
      ...(worker.build
        ? { build: worker.build.map((command) => nativeCommand(command, root, projectRoot)) }
        : {}),
      ...(worker.start ? { start: nativeCommand(worker.start, root, projectRoot) } : {}),
    }));
    const commands = [
      ...new Map(
        project.workers
          .flatMap((worker) => worker.build ?? [])
          .map((command) => [JSON.stringify(command), command]),
      ).values(),
    ];
    const goWorkers = project.workers.filter((worker) => worker.language === "go");
    const checked = new Set<WorkerProgram>();
    for (const command of commands) {
      const candidates = [];
      for (const worker of goWorkers.filter(
        (worker) =>
          worker.build?.length === 1 && JSON.stringify(worker.build[0]) === JSON.stringify(command),
      ))
        candidates.push({ worker, source: await proveGoWorker(worker) });
      await runNativeCommand(command, nativeStdout);
      // No other native build runs between typed source proof, exact compilation and binding.
      for (const { worker, source } of candidates) {
        const result =
          source.state === "source" ? await proveGoWorker(worker, source.sourceSha256) : source;
        checked.add(worker);
        if (result.state === "bound") worker.coverage = result.proof;
        project.diagnostics.push({
          code: result.state === "bound" ? "go.coverage-established" : "go.coverage-unavailable",
          severity: "info",
          source: worker.source,
          message:
            result.state === "bound"
              ? "The compiled native closure establishes at most one unversioned Worker on the recorded queue/task types. Direct POSIX launch plus matching fresh native observations are still required for retirement."
              : result.state === "unknown"
                ? result.reason
                : "Native source evidence was not bound to compilation.",
        });
      }
    }
    for (const worker of goWorkers.filter((worker) => !checked.has(worker)))
      project.diagnostics.push({
        code: "go.coverage-unavailable",
        severity: "info",
        source: worker.source,
        message: "Coverage requires one ordinary native Go build and direct launch plan.",
      });
    const runtimes = new Map([
      ["rust", "rustc"],
      ["typescript", "node"],
    ]);
    const tools = await toolVersions([
      ...commands,
      ...[...new Set(project.workers.map((worker) => runtimes.get(worker.language)))].flatMap(
        (executable) => (executable ? [{ executable, args: [], cwd: root }] : []),
      ),
    ]);
    await writeDiscovery(project);
    const outputs = await inventory(root, projectRoot);
    const originals = new Map(inputs.map((entry) => [entry.path, JSON.stringify(entry)]));
    const outputPaths = new Set(outputs.map(({ path }) => path));
    const nativeOutput = project.workers.flatMap(({ id, nativeOutput }) => {
      if (!nativeOutput) return [];
      for (const path of nativeOutput.paths ?? []) {
        if (path !== "." && !outputPaths.has(path))
          throw new Error(`Native build did not produce ${path} for ${id}.`);
      }
      return [{ workerId: id, ...nativeOutput }];
    });
    const emittedKinds = new Map(emitted.artifacts.map(({ path, kind }) => [path, kind]));
    const artifacts = outputs
      .filter((entry) => originals.get(entry.path) !== JSON.stringify(entry))
      .map((entry): BuildArtifact => ({
        path: entry.path,
        kind: emittedKinds.get(entry.path) ?? "native-output",
        entry,
      }));
    const manifestPath = join(version, "manifest.json");
    const metadataPath = join(version, "metadata.json");
    const build: PublishedBuild = {
      schemaVersion: 1,
      id,
      projectRoot,
      root,
      manifestPath,
      metadataPath,
      workers: project.workers,
      artifacts,
      inputs,
      tools,
    };
    const installation = fileURLToPath(new URL("../", import.meta.url));
    const generatorInputs = (
      await Promise.all(
        ["dist", "sdk", "src/sdk", "native"].map(async (path) =>
          (await inventory(join(installation, path))).map((entry) => ({
            ...entry,
            path: `${path}/${entry.path}`,
          })),
        ),
      )
    ).flat();
    generatorInputs.push({
      path: "package.json",
      kind: "file",
      sha256: await hash(join(installation, "package.json")),
      size: (await lstat(join(installation, "package.json"))).size,
      mode: (await lstat(join(installation, "package.json"))).mode & 0o777,
    });
    const metadata = {
      schemaVersion: 1,
      id,
      inputs,
      tools,
      generatorInputs,
      generation: emitted.artifacts.map(({ path, kind, content }) => ({
        path,
        kind,
        sha256: createHash("sha256").update(content).digest("hex"),
      })),
      platform: process.platform,
      architecture: process.arch,
      buildHost: { platform: process.platform, architecture: process.arch },
      nativeOutput,
      commands,
      // Hash environment values: credentials and arbitrary application values are not metadata.
      environmentSha256: createHash("sha256")
        .update(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))))
        .digest("hex"),
      removedInputs: inputs.filter((input) => !outputPaths.has(input.path)).map(({ path }) => path),
      diagnostics: project.diagnostics,
    };
    const manifest = {
      schemaVersion: 1,
      id,
      projectRoot,
      root,
      manifestPath,
      metadataPath,
      artifacts,
      workers: project.workers,
      discovery: project.manifest,
    };
    await json(metadataPath, metadata);
    await json(manifestPath, manifest);
    await json(temporary, manifest);
    // Convenience metadata follows the authoritative manifest; it never selects a build.
    await json(metadataTemporary, {
      schemaVersion: 1,
      manifest: "manifest.json",
      metadataField: "metadataPath",
    });
    await rename(metadataTemporary, join(compile, "metadata.json"));
    await rename(temporary, join(compile, "manifest.json"));
    published = true;
    ownedBuilds.set(build, { id, version, projectRoot });
    return { state: "published", project, build };
  } finally {
    await rm(temporary, { force: true });
    await rm(metadataTemporary, { force: true });
    if (!published) await rm(version, { recursive: true, force: true });
  }
}

/** Caller supplies every build required by its live or retained Workers. No directory sweep. */
export async function cleanupBuild(
  build: PublishedBuild,
  requiredBuildIds: ReadonlySet<string>,
): Promise<boolean> {
  const owned = ownedBuilds.get(build);
  if (!owned) throw new Error("Cannot remove a build not owned by this process.");
  if (requiredBuildIds.has(owned.id)) return false;
  const current: unknown = JSON.parse(
    await readFile(join(owned.projectRoot, ".gsys", "compile", "manifest.json"), "utf8"),
  );
  if (
    !current ||
    typeof current !== "object" ||
    !("id" in current) ||
    typeof current.id !== "string"
  )
    throw new Error("Cannot establish current build ownership.");
  if (current.id === owned.id) return false;
  await rm(owned.version, { recursive: true });
  ownedBuilds.delete(build);
  return true;
}

/** A development build child belongs to the same owning session. */
export async function ownBuild(build: PublishedBuild): Promise<void> {
  const version = join(build.projectRoot, ".gsys", "compile", "builds", build.id);
  if (
    build.root !== join(version, "project") ||
    build.manifestPath !== join(version, "manifest.json")
  )
    throw new Error("Build child returned an unexpected snapshot path.");
  if (build.metadataPath !== join(version, "metadata.json"))
    throw new Error("Build child returned an unexpected metadata path.");
  const manifest: unknown = JSON.parse(await readFile(build.manifestPath, "utf8"));
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("id" in manifest) ||
    manifest.id !== build.id ||
    !("root" in manifest) ||
    manifest.root !== build.root ||
    !("workers" in manifest) ||
    JSON.stringify(manifest.workers) !== JSON.stringify(build.workers)
  )
    throw new Error("Build child result does not match its published manifest.");
  ownedBuilds.set(build, { id: build.id, version, projectRoot: build.projectRoot });
}
