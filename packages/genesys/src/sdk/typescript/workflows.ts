import { relative } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Diagnostic } from "../../contracts.js";
import { location, slash, type CompilerModel } from "./compiler.js";
import { literal, native, value } from "./expressions.js";

export function bundleSource(
  current: CompilerModel,
  expression: ts.Expression,
): ts.SourceFile | undefined {
  const node = value(current.checker, expression);
  let specifier: string | undefined;
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "require" &&
    node.expression.name.text === "resolve"
  )
    specifier = literal(current.checker, node.arguments[0]);
  if (
    ts.isCallExpression(node) &&
    node.arguments[0] &&
    native(current.checker, node.expression, "node:url", "fileURLToPath")
  )
    return bundleSource(current, node.arguments[0]);
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "URL" &&
    node.arguments?.[1]?.getText() === "import.meta.url"
  )
    specifier = literal(current.checker, node.arguments[0]);
  if (!specifier) return;
  const resolved = ts.resolveModuleName(
    specifier,
    node.getSourceFile().fileName,
    current.parsed.options,
    ts.sys,
  ).resolvedModule;
  if (resolved) return current.program.getSourceFile(resolved.resolvedFileName);
  return;
}

export function sandboxImports(
  context: AnalysisContext,
  current: CompilerModel,
  file: ts.SourceFile,
  diagnostics: Diagnostic[],
  seen = new Set<string>(),
): void {
  if (seen.has(file.fileName)) return;
  seen.add(file.fileName);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (
      ts.isImportDeclaration(statement) &&
      (statement.importClause?.isTypeOnly ||
        (statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings) &&
          !statement.importClause.name &&
          statement.importClause.namedBindings.elements.length > 0 &&
          statement.importClause.namedBindings.elements.every((element) => element.isTypeOnly)))
    )
      continue;
    if (
      ts.isExportDeclaration(statement) &&
      (statement.isTypeOnly ||
        (statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length > 0 &&
          statement.exportClause.elements.every((element) => element.isTypeOnly)))
    )
      continue;
    const resolved = ts.resolveModuleName(
      statement.moduleSpecifier.text,
      file.fileName,
      current.parsed.options,
      ts.sys,
    ).resolvedModule;
    if (!resolved) continue;
    const source = current.program.getSourceFile(resolved.resolvedFileName);
    if (!source || source.isDeclarationFile) continue;
    const path = slash(relative(context.projectRoot, source.fileName));
    if (
      context.entries.some(
        (entry) =>
          entry.path === path &&
          (entry.role === "activity" || entry.role === "nexus" || entry.role === "worker"),
      )
    ) {
      diagnostics.push({
        code: "typescript.workflow-runtime-import",
        severity: "error",
        source: location(context, statement),
        related: [{ path }],
        message:
          "Workflow code imports a Worker, Activity, or Nexus implementation at runtime. Use type-only Activity imports and native Workflow proxies to keep the Workflow bundle sandboxed.",
      });
    } else sandboxImports(context, current, source, diagnostics, seen);
  }
}
