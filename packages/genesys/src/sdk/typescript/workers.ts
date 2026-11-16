import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript-compiler";
import type {
  AnalysisContext,
  Command,
  Diagnostic,
  GeneratedArtifact,
  NativeOutput,
  SourceEntry,
  WorkerProgram,
} from "../../contracts.js";
import { slash, type compilerModels, type CompilerModel } from "./compiler.js";
import { unwrap } from "./expressions.js";

function inside(root: string, path: string): boolean {
  const child = slash(relative(root, path));
  return !isAbsolute(child) && child !== ".." && !child.startsWith("../");
}

function javascriptOutput(parsed: ts.ParsedCommandLine, input: string): string | undefined {
  if (parsed.options.noEmit || parsed.options.emitDeclarationOnly) return;
  try {
    return ts
      .getOutputFileNames(parsed, input, !ts.sys.useCaseSensitiveFileNames)
      .find((path) => /\.[cm]?jsx?$/.test(path));
  } catch {
    return;
  }
}

function buildBoundary(
  root: string,
  config: string,
  parsed: ts.ParsedCommandLine,
  seen = new Set<string>(),
  program?: ts.Program,
): string | undefined {
  if (seen.has(config)) return;
  seen.add(config);
  const { options, fileNames, projectReferences } = parsed;
  const buildInfo = ts.getTsBuildInfoEmitOutputFilePath({ ...options, incremental: true });
  for (const path of [config, options.outDir, options.outFile, options.declarationDir, buildInfo]) {
    if (path && !inside(root, path)) return path;
  }
  for (const reference of projectReferences ?? []) {
    const path = ts.resolveProjectReferencePath(reference);
    if (!inside(root, path)) return path;
    if (seen.has(path)) continue;
    const result = ts.readConfigFile(path, ts.sys.readFile);
    if (result.error) continue; // The native compiler reports invalid or missing configs.
    const child = ts.parseJsonConfigFileContent(
      result.config,
      ts.sys,
      dirname(path),
      undefined,
      path,
    );
    const escaped = buildBoundary(root, path, child, seen);
    if (escaped) return escaped;
  }
  if (options.noEmit) return;
  program ??= ts.createProgram({ rootNames: fileNames, options, projectReferences });
  for (const file of program.getSourceFiles()) {
    if (
      !file.isDeclarationFile &&
      !program.isSourceFileFromExternalLibrary(file) &&
      !inside(root, file.fileName)
    )
      return file.fileName;
  }
}

function registrationPrograms(
  root: string,
  modelsByConfig: Map<string, CompilerModel>,
  registration: GeneratedArtifact[],
) {
  return registration.flatMap(({ path }) => {
    const input = resolve(root, path);
    const config = ts.findConfigFile(dirname(input), ts.sys.fileExists);
    const model = config && modelsByConfig.get(config);
    if (!model) return [];
    const parsed = { ...model.parsed, fileNames: [...model.parsed.fileNames, slash(input)] };
    const output = javascriptOutput(parsed, input);
    return output ? [{ model, output: resolve(output) }] : [];
  });
}

function entrySource(context: AnalysisContext, model: CompilerModel, entry: SourceEntry) {
  const input = resolve(context.projectRoot, entry.path);
  const file = model.program.getSourceFile(input);
  if (file || context.mode !== "production" || !/\.[cm]?js$/.test(input)) return file;
  const content = context.sources.get(entry.path);
  if (content !== undefined) return ts.createSourceFile(input, content, ts.ScriptTarget.Latest);
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
  registration,
}: {
  context: AnalysisContext;
  entries: SourceEntry[];
  models: Map<string, CompilerModel>;
  diagnostics: Diagnostic[];
  program: WorkerProgram;
  tsc: string | undefined;
  dependencies: NonNullable<NativeOutput["dependencies"]>;
  nodeVersion: unknown;
  registration: ReturnType<typeof registrationPrograms>;
}): Map<string, string> {
  const { projectRoot } = context;
  const commands = new Map<string, Command>();
  const paths = new Map<string, string>();
  const required = new Set<string>();
  const packageRoot = resolve(projectRoot, context.package.root);
  function addBuild(entry: SourceEntry, model: CompilerModel, output: string) {
    const { config } = model;
    if (config && commands.has(config) && inside(projectRoot, output)) return true;
    const escaped = !inside(projectRoot, output)
      ? output
      : config && buildBoundary(projectRoot, config, model.parsed, undefined, model.program);
    if (config && tsc && !escaped) {
      commands.set(config, compilerCommand(context, tsc, config));
      return true;
    }
    report(
      entry,
      escaped
        ? `Native tsconfig inputs, build references, and outputs must be inside the selected project: ${escaped}.`
        : "Install the application's TypeScript compiler within the selected project.",
    );
    return false;
  }
  function report(entry: SourceEntry, reason: string) {
    diagnostics.push({
      code: "typescript.production-output-unavailable",
      severity: "error",
      source: { path: entry.path },
      message: `${reason} The production build invokes the installed TypeScript compiler directly.`,
    });
  }
  for (const entry of entries) {
    const input = resolve(projectRoot, entry.path);
    const model = models.get(entry.path)!;
    const output = javascriptOutput(model.parsed, input);
    if (!output && /\.[cm]?js$/.test(entry.path)) paths.set(entry.path, input);
    else if (!model.config || !output)
      report(entry, "The native tsconfig must emit JavaScript for this entry.");
    else if (addBuild(entry, model, output)) paths.set(entry.path, output);

    const file = entrySource(context, model, entry);
    const referenced = new Set<string>();
    const directories = new Set([dirname(input), dirname(output ?? input), packageRoot]);
    function visit(node: ts.Node) {
      if (ts.isStringLiteralLike(node))
        for (const dir of directories) referenced.add(resolve(dir, node.text));
      ts.forEachChild(node, visit);
    }
    if (file) visit(file);
    for (const { model, output } of registration) {
      const consumes =
        referenced.has(output) || (output.endsWith(".js") && referenced.has(output.slice(0, -3)));
      if (consumes && addBuild(entry, model, output)) required.add(output);
    }
  }
  if (commands.size) program.build = [...commands.values()];
  program.nativeOutput = {
    paths: [
      ...new Set(
        [...paths.values(), ...required].map((path) => slash(relative(projectRoot, path))),
      ),
    ],
    target: { runtime: "Node.js" },
    ...(dependencies.length ? { dependencies } : {}),
    runtimeRequirements: [typeof nodeVersion === "string" ? `Node.js ${nodeVersion}` : "Node.js"],
  };
  return paths;
}

export function workerPrograms(
  context: AnalysisContext,
  { models, byConfig }: ReturnType<typeof compilerModels>,
  diagnostics: Diagnostic[],
  artifacts: GeneratedArtifact[],
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
  const registration = registrationPrograms(context.projectRoot, byConfig, artifacts);
  for (const [name, entries] of groups) {
    const declaredEntries = entries.filter((entry) => {
      const input = resolve(context.projectRoot, entry.path);
      const output = javascriptOutput(models.get(entry.path)!.parsed, input);
      return declared.some((path) =>
        [input, output].includes(resolve(context.projectRoot, context.package.root, path)),
      );
    });
    const candidates = declaredEntries.length
      ? declaredEntries
      : entries.filter((entry) => {
          const current = models.get(entry.path)!;
          const file = entrySource(context, current, entry);
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
            registration,
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
      const output = javascriptOutput(current.parsed, input);
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
