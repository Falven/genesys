import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Diagnostic, SourceEntry, WorkerProgram } from "../../contracts.js";
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
          const output = outputPath(current, input);
          if (
            declared.some((path) =>
              [input, output].includes(resolve(context.projectRoot, context.package.root, path)),
            )
          )
            return true;
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
    if (manifest.scripts?.build && ["npm", "pnpm", "yarn", "bun"].includes(packageManager)) {
      program.build = [{ executable: packageManager, args: ["run", "build"], cwd }];
    } else if (
      current.config &&
      !current.parsed.options.noEmit &&
      !current.parsed.options.emitDeclarationOnly
    ) {
      let directory = resolve(context.projectRoot, cwd);
      let tsc: string | undefined;
      while (inside(context.projectRoot, directory)) {
        const candidate = join(directory, "node_modules/typescript/bin/tsc");
        if (ts.sys.fileExists(candidate)) {
          tsc = candidate;
          break;
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      if (tsc)
        program.build = [
          {
            executable: "node",
            args: [
              slash(relative(resolve(context.projectRoot, cwd), tsc)),
              "--build",
              slash(relative(resolve(context.projectRoot, cwd), current.config)),
            ],
            cwd,
          },
        ];
      else
        diagnostics.push({
          code: "typescript.compiler-unavailable",
          severity: "warning",
          source: { path: source.path },
          message:
            "Install the package's TypeScript compiler or provide its native build script. Genesys does not choose an application compiler version.",
        });
    }
    if (candidates.length === 1) {
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
    } else
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
