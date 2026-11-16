import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript-compiler";
import type {
  AnalysisContext,
  Command,
  Diagnostic,
  NativeOutput,
  SourceEntry,
  WorkerProgram,
} from "../../contracts.js";
import { slash, type CompilerModel } from "./compiler.js";
import { unwrap } from "./expressions.js";

function inside(root: string, path: string): boolean {
  const child = slash(relative(root, path));
  return !isAbsolute(child) && child !== ".." && !child.startsWith("../");
}

function outputPath(model: CompilerModel, input: string): string | undefined {
  if (model.parsed.options.noEmit || model.parsed.options.emitDeclarationOnly) return;
  try {
    return ts
      .getOutputFileNames(model.parsed, input, !ts.sys.useCaseSensitiveFileNames)
      .find((path) => /\.[cm]?jsx?$/.test(path));
  } catch {
    return;
  }
}

function packageDirectories(context: AnalysisContext): string[] {
  const directories: string[] = [];
  let directory = resolve(context.projectRoot, context.package.root);
  while (inside(context.projectRoot, directory)) {
    directories.push(directory);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return directories;
}

function compilerCommand(context: AnalysisContext, tsc: string, config: string): Command {
  const cwd = resolve(context.projectRoot, context.package.root);
  return {
    executable: "node",
    args: [
      slash(relative(cwd, tsc)),
      "--build",
      ...(context.mode === "production" ? ["--force"] : []),
      slash(relative(cwd, config)),
    ],
    cwd: context.package.root,
  };
}

function planProduction({
  context,
  entries,
  models,
  diagnostics,
  program,
  tsc,
  dependencies,
  nodeVersion,
}: {
  context: AnalysisContext;
  entries: SourceEntry[];
  models: Map<string, CompilerModel>;
  diagnostics: Diagnostic[];
  program: WorkerProgram;
  tsc: string | undefined;
  dependencies: NonNullable<NativeOutput["dependencies"]>;
  nodeVersion: unknown;
}): Map<string, string> {
  const { projectRoot } = context;
  const commands = new Map<string, Command>();
  const paths = new Map<string, string>();
  for (const entry of entries) {
    const input = resolve(projectRoot, entry.path);
    const model = models.get(entry.path)!;
    const output = outputPath(model, input);
    if (!output && /\.[cm]?js$/.test(entry.path)) {
      paths.set(entry.path, input);
      continue;
    }
    const { config, parsed } = model;
    const locations = [
      config,
      output,
      parsed.options.outDir,
      parsed.options.outFile,
      parsed.options.declarationDir,
      parsed.options.tsBuildInfoFile,
    ];
    const externalOutput = locations.some((path) => path && !inside(projectRoot, path));
    if (config && output && tsc && !externalOutput) {
      commands.set(config, compilerCommand(context, tsc, config));
      paths.set(entry.path, output);
    } else {
      const reason =
        !config || !output
          ? "The native tsconfig must emit JavaScript for this entry."
          : externalOutput
            ? "The native tsconfig and its output paths must be inside the selected project."
            : "Install the application's TypeScript compiler within the selected project.";
      diagnostics.push({
        code: "typescript.production-output-unavailable",
        severity: "error",
        source: { path: entry.path },
        message: `${reason} The production build invokes the installed TypeScript compiler directly.`,
      });
    }
  }
  if (commands.size) program.build = [...commands.values()];
  program.nativeOutput = {
    paths: [...new Set([...paths.values()].map((path) => slash(relative(projectRoot, path))))],
    target: { runtime: "Node.js" },
    ...(dependencies.length ? { dependencies } : {}),
    runtimeRequirements: [typeof nodeVersion === "string" ? `Node.js ${nodeVersion}` : "Node.js"],
  };
  return paths;
}

export function workerPrograms(
  context: AnalysisContext,
  models: Map<string, CompilerModel>,
  diagnostics: Diagnostic[],
): WorkerProgram[] {
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of context.entries.filter(
    (entry) => entry.role === "worker" && entry.workerName,
  )) {
    const group = groups.get(entry.workerName!) ?? [];
    group.push(entry);
    groups.set(entry.workerName!, group);
  }
  const manifestPath = context.package.manifests.find((path) => path.endsWith("package.json"));
  const manifest = manifestPath ? JSON.parse(context.sources.get(manifestPath) ?? "{}") : {};
  const declared = [
    manifest.main,
    ...(typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {})),
  ].filter((path): path is string => typeof path === "string");
  const directories = packageDirectories(context);
  const tsc = directories
    .map((directory) => join(directory, "node_modules/typescript/bin/tsc"))
    .find(ts.sys.fileExists);
  const dependencies = directories
    .map((directory) => join(directory, "node_modules"))
    .filter(ts.sys.directoryExists)
    .map((path) => ({ path: slash(relative(context.projectRoot, path)), kind: "node_modules" }));
  const programs: WorkerProgram[] = [];
  for (const [name, entries] of groups) {
    const declaredEntries = entries.filter((entry) => {
      const input = resolve(context.projectRoot, entry.path);
      const output = outputPath(models.get(entry.path)!, input);
      return declared.some((path) =>
        [input, output].includes(resolve(context.projectRoot, context.package.root, path)),
      );
    });
    const candidates = declaredEntries.length
      ? declaredEntries
      : entries.filter((entry) => {
          const current = models.get(entry.path)!;
          const input = resolve(context.projectRoot, entry.path);
          const file = current.program.getSourceFile(input);
          return (
            file?.statements.some(
              (statement) =>
                ts.isExpressionStatement(statement) &&
                (ts.isCallExpression(unwrap(statement.expression)) ||
                  ts.isAwaitExpression(unwrap(statement.expression))),
            ) ?? false
          );
        });
    const source = candidates[0] ?? entries[0]!;
    const current = models.get(source.path)!;
    const program: WorkerProgram = {
      id: `typescript:${context.package.id}:${name}`,
      name,
      language: "typescript",
      packageId: context.package.id,
      source: { path: source.path },
      readiness: {
        state: "unavailable",
        description:
          "Native Worker heartbeats and process-attributed successful polls are required. RUNNING and process startup do not prove readiness; dynamic Worker instance coverage and native retirement remain unknown.",
        evidence: [
          "Worker heartbeat host/PID/start time",
          "WorkerPollerInfo.last_successful_poll_time",
          "Native deployment drainage separately from readiness",
        ],
      },
    };
    const cwd = context.package.root;
    const packageManager =
      typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : "npm";
    const production =
      context.mode === "production"
        ? planProduction({
            context,
            entries: candidates.length ? candidates : entries,
            models,
            diagnostics,
            program,
            tsc,
            dependencies,
            nodeVersion: manifest.engines?.node,
          })
        : undefined;
    if (production) {
      const script = production.get(source.path);
      if (candidates.length === 1 && script) {
        if (/\.[cm]?js$/.test(script))
          program.start = {
            executable: "node",
            args: [slash(relative(resolve(context.projectRoot, cwd), script))],
            cwd,
          };
        else
          diagnostics.push({
            code: "typescript.worker-output-unresolved",
            severity: "warning",
            source: { path: source.path },
            message:
              "The native compiler preserves JSX. Use the application's native tooling to run this output.",
          });
      }
    } else if (manifest.scripts?.build && ["npm", "pnpm", "yarn", "bun"].includes(packageManager)) {
      program.build = [{ executable: packageManager, args: ["run", "build"], cwd }];
    } else if (
      current.config &&
      !current.parsed.options.noEmit &&
      !current.parsed.options.emitDeclarationOnly
    ) {
      if (tsc) program.build = [compilerCommand(context, tsc, current.config)];
      else
        diagnostics.push({
          code: "typescript.compiler-unavailable",
          severity: "warning",
          source: { path: source.path },
          message:
            "Install the package's TypeScript compiler or provide its native build script. Genesys does not choose an application compiler version.",
        });
    }
    if (!production && candidates.length === 1) {
      const input = resolve(context.projectRoot, source.path);
      const output = outputPath(current, input);
      const script = /\.[cm]?js$/.test(source.path) && !output ? input : output;
      if (script && inside(context.projectRoot, script) && (script === input || program.build))
        program.start = {
          executable: "node",
          args: [slash(relative(resolve(context.projectRoot, cwd), script))],
          cwd,
        };
      else
        diagnostics.push({
          code: "typescript.worker-output-unresolved",
          severity: "warning",
          source: { path: source.path },
          message:
            "Native Worker executable output is unresolved (no emit, custom bundler, or missing tsconfig). Use the native startup override; no source loader is assumed.",
        });
    }
    if (candidates.length !== 1)
      diagnostics.push({
        code: "typescript.worker-entrypoint-ambiguous",
        severity: "warning",
        source: { path: source.path },
        related: candidates.map((entry) => ({ path: entry.path })),
        message: `Worker ${name} has ${candidates.length} executable candidates. Declare the native package main/bin or use a startup override.`,
      });
    programs.push(program);
  }
  return programs;
}
