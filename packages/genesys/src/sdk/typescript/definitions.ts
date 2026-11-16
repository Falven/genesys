import { resolve } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Definition, Diagnostic } from "../../contracts.js";
import { compilerDiagnostic, location, type CompilerModel } from "./compiler.js";
import {
  callable,
  isService,
  objectProperties,
  serviceName,
  symbol,
  value,
} from "./expressions.js";
import { handlerKey } from "./message-handlers.js";
import { sandboxImports } from "./workflows.js";

export function exportedDefinitions({
  context,
  models,
  messageHandlers,
  nativeAssembly,
  diagnostics,
}: {
  context: AnalysisContext;
  models: ReadonlyMap<string, CompilerModel>;
  messageHandlers: ReadonlySet<string>;
  nativeAssembly: ReadonlySet<string>;
  diagnostics: Diagnostic[];
}): Definition[] {
  const definitions: Definition[] = [];
  for (const entry of context.entries.filter((entry) => entry.role !== "worker")) {
    const current = models.get(entry.path)!;
    const { checker, program } = current;
    const file = program.getSourceFile(resolve(context.projectRoot, entry.path));
    if (!file) {
      diagnostics.push({
        code: "typescript.source-excluded",
        severity: "warning",
        source: { path: entry.path },
        message: "Native tsconfig excludes this source. No registration is generated.",
      });
      continue;
    }
    diagnostics.push(
      ...program.getSyntacticDiagnostics(file).map((error) => compilerDiagnostic(context, error)),
    );
    diagnostics.push(
      ...program
        .getSemanticDiagnostics(file)
        .filter((error) => [2308, 2307, 7016, 2792].includes(error.code))
        .map((error) => ({
          ...compilerDiagnostic(context, error),
          severity: error.code === 2308 ? ("error" as const) : ("warning" as const),
        })),
    );
    if (entry.role === "workflow") sandboxImports(context, current, file, diagnostics);
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) {
      diagnostics.push({
        code: "typescript.no-module-exports",
        severity: "warning",
        source: { path: entry.path },
        message:
          "This file has no statically resolved module exports. Preserve explicit native assembly.",
      });
      continue;
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      if (!declaration || !(target.flags & ts.SymbolFlags.Value)) continue;
      if (nativeAssembly.has(`${declaration.getSourceFile().fileName}:${target.name}`)) continue;
      if (entry.role === "workflow") {
        const resolved =
          ts.isVariableDeclaration(declaration) && declaration.initializer
            ? value(checker, declaration.initializer)
            : undefined;
        const resolvedTarget = resolved
          ? symbol(checker, ts.isPropertyAccessExpression(resolved) ? resolved.name : resolved)
          : undefined;
        if (
          messageHandlers.has(handlerKey(declaration)) ||
          resolvedTarget?.declarations?.some((node) => messageHandlers.has(handlerKey(node))) ||
          (resolved && messageHandlers.has(handlerKey(resolved)))
        ) {
          diagnostics.push({
            code: "typescript.message-handler-excluded",
            severity: "info",
            source: location(context, declaration),
            message: `Export ${exported.name} is a native message handler or validator, not an automatic Workflow registration. Explicit native assembly remains available.`,
          });
          continue;
        }
      }
      const type = checker.getTypeOfSymbolAtLocation(target, declaration);
      const expression = ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : ts.isExportAssignment(declaration)
          ? declaration.expression
          : undefined;
      const name = exported.name;
      const base = {
        id: `${entry.id}:${entry.role}:${name}`,
        source: location(context, declaration),
        entryId: entry.id,
        language: "typescript" as const,
        symbol: name,
      };
      if (entry.role === "nexus") {
        if (expression && isService(checker, expression)) {
          const nativeName = serviceName(checker, expression);
          definitions.push({
            ...base,
            kind: "nexus",
            identity: nativeName
              ? { name: nativeName, state: "resolved" }
              : {
                  state: "unresolved",
                  reason:
                    "Nexus service name is not statically known; preserve its native service contract.",
                },
          });
        } else if (type.getCallSignatures().length || type.getConstructSignatures().length)
          diagnostics.push({
            code: "typescript.nexus-native-assembly",
            severity: "warning",
            source: location(context, declaration),
            message: `Export ${name} needs native service construction. Supply the existing ServiceHandler through Worker.nexusServices; Genesys does not invoke factories.`,
          });
      } else if (type.getCallSignatures().length) {
        definitions.push({
          ...base,
          kind: entry.role as "workflow" | "activity",
          identity:
            entry.role === "workflow" && name === "default"
              ? {
                  state: "dynamic",
                  reason:
                    "The default Workflow export is the native fallback for unknown Workflow types.",
                }
              : { name, state: "resolved" },
        });
      } else if (
        entry.role === "activity" &&
        expression &&
        (ts.isNewExpression(value(checker, expression)) ||
          (type.getSymbol()?.flags ?? 0) & ts.SymbolFlags.Class)
      ) {
        diagnostics.push({
          code: "typescript.activity-instance-required",
          severity: "warning",
          source: location(context, declaration),
          message: `Activity instance ${name} needs an explicit native function mapping. Prototype methods are not enumerable Activity registrations; Genesys does not bind methods or construct dependencies.`,
        });
      } else if (
        entry.role === "activity" &&
        expression &&
        !type.getConstructSignatures().length &&
        type
          .getProperties()
          .some(
            (member) =>
              checker.getTypeOfSymbolAtLocation(member, declaration).getCallSignatures().length,
          )
      ) {
        const mapping = objectProperties(checker, expression, (node) =>
          diagnostics.push({
            code: "typescript.activity-map-unresolved",
            severity: "warning",
            source: location(context, node),
            message: `Activity export ${name} has dynamic mapping keys. Keep its native assembly for entries that cannot be enumerated.`,
          }),
        );
        for (const [memberName, implementation] of mapping) {
          if (!callable(checker, implementation) && !ts.isMethodDeclaration(implementation))
            continue;
          definitions.push({
            ...base,
            id: `${base.id}:${memberName}`,
            kind: "activity",
            symbol: `${name}[${JSON.stringify(memberName)}]`,
            identity: { name: memberName, state: "resolved" },
            construction: {
              symbol: name,
              reason:
                "Existing exported Activity mapping; reuse its function values without constructing dependencies.",
            },
          });
        }
      } else if (entry.role === "activity" && type.getConstructSignatures().length) {
        diagnostics.push({
          code: "typescript.activity-instance-required",
          severity: "warning",
          source: location(context, declaration),
          message: `Activity class ${name} needs an application-owned instance and bound function mapping. Preserve native Worker assembly; constructor arguments are never generated.`,
        });
      } else if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        diagnostics.push({
          code: "typescript.export-unresolved",
          severity: "warning",
          source: location(context, declaration),
          message: `Export ${name} has unresolved type information. Install native dependencies and resolve package imports or retain explicit native assembly.`,
        });
      }
    }
  }
  return definitions;
}
