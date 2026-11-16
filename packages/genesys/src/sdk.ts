import { spawn } from "node:child_process";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment, windowsCommand } from "./windows-command.js";
import { discoverProject } from "./discovery.js";
import type {
  AnalysisContext,
  AnalysisResult,
  Command,
  Diagnostic,
  DiscoveryResult,
  GeneratedArtifact,
  NativeAdapter,
  WorkerProgram,
} from "./contracts.js";

export interface AnalyzedProject extends DiscoveryResult {
  workers: WorkerProgram[];
  packages: { context: AnalysisContext; analysis: AnalysisResult; adapter: NativeAdapter }[];
}
export interface EmittedProject {
  artifacts: GeneratedArtifact[];
  diagnostics: Diagnostic[];
}

/** Only internal, known SDK names are used to resolve modules. */
export async function analyzeProject(projectPath: string): Promise<AnalyzedProject> {
  const result = await discoverProject(projectPath);
  const project: AnalyzedProject = { ...result, workers: [], packages: [] };
  project.diagnostics = result.diagnostics.filter(
    (item) => item.code !== "analysis.source-inventory-only",
  );
  for (const pkg of result.manifest.packages) {
    const url = new URL(`./sdk/${pkg.language}.js`, import.meta.url);
    try {
      await access(fileURLToPath(url));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      project.diagnostics.push({
        code: "sdk.adapter-unavailable",
        severity: "error",
        source: { path: pkg.root },
        message: `Native ${pkg.language} analysis is not available in this Genesys installation.`,
      });
      continue;
    }
    const module = (await import(url.href)) as Record<string, NativeAdapter>;
    const adapter = module[`${pkg.language}Adapter`];
    if (!adapter || adapter.language !== pkg.language)
      throw new Error(`Invalid internal SDK adapter: ${pkg.language}`);
    const context: AnalysisContext = {
      projectRoot: result.projectRoot,
      package: pkg,
      entries: result.manifest.entries.filter((entry) => entry.packageId === pkg.id),
      sources: result.sources,
    };
    try {
      const analysis = await adapter.analyze(context);
      analysis.workers = analysis.workers.map((worker) => ({
        ...worker,
        workingDirectory: worker.workingDirectory ?? worker.start?.cwd ?? context.package.root,
      }));
      project.packages.push({ context, analysis, adapter });
      project.manifest.definitions.push(...analysis.definitions);
      project.diagnostics.push(...analysis.diagnostics);
      project.workers.push(...analysis.workers);
    } catch (error) {
      project.diagnostics.push({
        code: "sdk.analysis-failed",
        severity: "error",
        source: { path: pkg.root },
        message: `${pkg.language}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  project.manifest.analysis = "native-analysis";
  const names = new Map<string, WorkerProgram>();
  for (const worker of project.workers) {
    const previous = names.get(worker.name);
    if (previous)
      project.diagnostics.push({
        code: "worker.ambiguous-name",
        severity: "error",
        source: worker.source,
        related: [previous.source],
        message: `Multiple native programs have Worker name ${worker.name}.`,
      });
    names.set(worker.name, worker);
  }
  return project;
}

export async function emitProject(project: AnalyzedProject): Promise<EmittedProject> {
  const artifacts: GeneratedArtifact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { context, analysis, adapter } of project.packages) {
    const emitted = await adapter.emit({ ...context, analysis });
    artifacts.push(...emitted.artifacts);
    diagnostics.push(...emitted.diagnostics);
  }
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (paths.has(artifact.path))
      diagnostics.push({
        code: "generation.output-collision",
        severity: "error",
        source: { path: artifact.path },
        message: "Multiple SDK outputs target the same path.",
      });
    paths.add(artifact.path);
  }
  return { artifacts, diagnostics };
}

/** Writes only inside the supplied workspace and never replaces authored files. */
export async function writeArtifacts(
  projectRoot: string,
  artifacts: readonly GeneratedArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    const destination = resolve(projectRoot, artifact.path);
    const path = relative(projectRoot, destination);
    if (!path || isAbsolute(artifact.path) || path === ".." || path.startsWith(`..${sep}`))
      throw new Error(`Output escapes workspace: ${artifact.path}`);
    let directory = projectRoot;
    for (const segment of relative(projectRoot, dirname(destination))
      .split(/[\\/]/)
      .filter(Boolean)) {
      directory = resolve(directory, segment);
      await mkdir(directory, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink())
        throw new Error(`Output directory is not a real directory: ${directory}`);
    }
    try {
      const stat = await lstat(destination);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`Output is not a regular file: ${artifact.path}`);
      const existing = await readFile(destination, "utf8");
      if (!artifact.path.startsWith(".gsys/") && !existing.includes("Code generated by Genesys"))
        throw new Error(`Refusing to overwrite authored file: ${artifact.path}`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await writeFile(destination, artifact.content);
  }
}

export async function runNativeCommand(
  original: Command,
  stdout: "inherit" | "stderr" = "inherit",
): Promise<void> {
  const command = windowsCommand(original, true);
  await new Promise<void>((accept, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: commandEnvironment(command),
      windowsVerbatimArguments: command.windowsVerbatimArguments,
      stdio: ["inherit", stdout === "stderr" ? process.stderr : "inherit", "inherit"],
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? accept() : reject(new Error(`${command.executable} failed (${signal ?? code})`)),
    );
  });
}
