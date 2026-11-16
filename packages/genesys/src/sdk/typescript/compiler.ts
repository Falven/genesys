import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Diagnostic, SourceEntry, SourceLocation } from "../../contracts.js";

export const slash = (path: string) => path.replaceAll("\\", "/");
const sourceExtension = /\.[cm]?[jt]sx?$/;

export interface CompilerModel {
  program: ts.Program;
  checker: ts.TypeChecker;
  config?: string;
  parsed: ts.ParsedCommandLine;
}

export function location(context: AnalysisContext, node: ts.Node): SourceLocation {
  const file = node.getSourceFile();
  const point = file.getLineAndCharacterOfPosition(node.getStart(file));
  return {
    path: slash(relative(context.projectRoot, file.fileName)),
    line: point.line + 1,
    column: point.character + 1,
  };
}

function createCompilerModel(
  context: AnalysisContext,
  entry: SourceEntry,
  diagnostics: Diagnostic[],
): CompilerModel {
  const root = resolve(context.projectRoot, context.package.root);
  const config = ts.findConfigFile(
    dirname(resolve(context.projectRoot, entry.path)),
    ts.sys.fileExists,
  );
  let parsed: ts.ParsedCommandLine;
  if (config) {
    const result = ts.readConfigFile(config, ts.sys.readFile);
    if (result.error) diagnostics.push(compilerDiagnostic(context, result.error));
    parsed = ts.parseJsonConfigFileContent(
      result.config ?? {},
      ts.sys,
      dirname(config),
      undefined,
      config,
    );
    diagnostics.push(...parsed.errors.map((error) => compilerDiagnostic(context, error)));
  } else {
    parsed = {
      options: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowJs: true,
        noEmit: true,
      },
      fileNames: [...context.sources.keys()]
        .filter(
          (path) =>
            sourceExtension.test(path) &&
            (context.package.root === "." || path.startsWith(`${context.package.root}/`)),
        )
        .map((path) => resolve(context.projectRoot, path)),
      errors: [],
    };
    diagnostics.push({
      code: "typescript.no-tsconfig",
      severity: "warning",
      source: { path: entry.path },
      message:
        "No tsconfig.json was found. Static analysis uses NodeNext resolution; TypeScript Worker builds need native package build settings.",
    });
  }
  const host = ts.createCompilerHost(parsed.options);
  const originalRead = host.readFile;
  host.readFile = (path) =>
    context.sources.get(slash(relative(context.projectRoot, path))) ?? originalRead(path);
  host.getCurrentDirectory = () => root;
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host,
    projectReferences: parsed.projectReferences,
  });
  return { program, checker: program.getTypeChecker(), config, parsed };
}

export function compilerDiagnostic(context: AnalysisContext, error: ts.Diagnostic): Diagnostic {
  return {
    code: `typescript.TS${error.code}`,
    severity: error.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    message: ts.flattenDiagnosticMessageText(error.messageText, "\n"),
    ...(error.file
      ? {
          source: {
            path: slash(relative(context.projectRoot, error.file.fileName)),
            line: error.file.getLineAndCharacterOfPosition(error.start ?? 0).line + 1,
          },
        }
      : {}),
  };
}

export function compilerModels(context: AnalysisContext, diagnostics: Diagnostic[]) {
  const models = new Map<string, CompilerModel>();
  const byConfig = new Map<string, CompilerModel>();
  for (const entry of context.entries) {
    const config =
      ts.findConfigFile(dirname(resolve(context.projectRoot, entry.path)), ts.sys.fileExists) ?? "";
    let current = byConfig.get(config);
    if (!current) {
      current = createCompilerModel(context, entry, diagnostics);
      byConfig.set(config, current);
    }
    models.set(entry.path, current);
  }
  return { models, byConfig };
}

export function sdkVersionDiagnostic(
  context: AnalysisContext,
  configurations: Iterable<CompilerModel>,
): Diagnostic {
  const manifestPath = context.package.manifests.find((path) => path.endsWith("package.json"));
  const manifest = manifestPath ? JSON.parse(context.sources.get(manifestPath) ?? "{}") : {};
  let installedSdk: string | undefined;
  const firstCompilerModel = Array.from(configurations)[0];
  const firstEntry = context.entries[0];
  if (firstCompilerModel && firstEntry) {
    const dependency = ts.resolveModuleName(
      "@temporalio/worker",
      resolve(context.projectRoot, firstEntry.path),
      firstCompilerModel.parsed.options,
      ts.sys,
    ).resolvedModule;
    if (dependency) {
      let directory = dirname(dependency.resolvedFileName);
      while (dirname(directory) !== directory) {
        const text = ts.sys.readFile(join(directory, "package.json"));
        if (text) {
          const metadata = JSON.parse(text);
          if (metadata.name === "@temporalio/worker") {
            installedSdk = metadata.version;
            break;
          }
        }
        directory = dirname(directory);
      }
    }
  }
  const requestedSdk =
    manifest.dependencies?.["@temporalio/worker"] ??
    manifest.devDependencies?.["@temporalio/worker"];
  return {
    code: "typescript.sdk-version",
    severity: "info",
    source: { path: manifestPath ?? context.package.root },
    message: `Declared @temporalio/worker: ${typeof requestedSdk === "string" ? requestedSdk : "not declared in this package"}; installed: ${installedSdk ?? "unresolved"}. Registration APIs reviewed against released SDK 1.25.0 and nexus-rpc 0.0.3. Static analysis uses TypeScript 6.0.3; native build validation uses the application's own compiler.`,
  };
}
