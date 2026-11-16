import { resolve } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Definition, Diagnostic } from "../../contracts.js";
import { location, type CompilerModel } from "./compiler.js";
import { callable, native, objectProperties, serviceName, symbol, value } from "./expressions.js";
import { bundleSource, sandboxImports } from "./workflows.js";

export function nativeRegistrations({
  context,
  configurations,
  models,
  diagnostics,
}: {
  context: AnalysisContext;
  configurations: Iterable<CompilerModel>;
  models: ReadonlyMap<string, CompilerModel>;
  diagnostics: Diagnostic[];
}) {
  const definitions: Definition[] = [];
  const nativeAssembly = new Set<string>();
  for (const current of configurations) {
    const { checker, program } = current;
    const fileEntries = new Map(
      context.entries.map((entry) => [resolve(context.projectRoot, entry.path), entry]),
    );
    for (const file of program.getSourceFiles()) {
      if (file.isDeclarationFile || !fileEntries.has(file.fileName)) continue;
      const entry = fileEntries.get(file.fileName)!;
      if (models.get(entry.path) !== current) continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "create" &&
          native(checker, node.expression.expression, "@temporalio/worker", "Worker")
        ) {
          const scope = `${entry.path}:${node.getStart(file)}`;
          const options = node.arguments[0];
          const properties = options
            ? objectProperties(checker, options, () => {})
            : new Map<string, ts.Node>();
          if (!options || !ts.isObjectLiteralExpression(value(checker, options)))
            diagnostics.push({
              code: "typescript.worker-options-unresolved",
              severity: "warning",
              source: location(context, node),
              message:
                "Worker options come from dynamic native assembly. Registration and Worker instance coverage remain incomplete; application construction is not executed.",
            });
          const activities = properties.get("activities");
          if (activities && ts.isExpression(activities)) {
            const resolved = value(checker, activities);
            if (ts.isCallExpression(resolved)) {
              const factory = symbol(checker, resolved.expression);
              for (const declaration of factory?.declarations ?? [])
                nativeAssembly.add(`${declaration.getSourceFile().fileName}:${factory!.name}`);
            }
            const mapping = objectProperties(checker, activities, (unresolved) =>
              diagnostics.push({
                code: "typescript.native-assembly-unresolved",
                severity: "warning",
                source: location(context, unresolved),
                message:
                  "Activity mapping is dynamic or has unknown keys. Keep its native assembly; static discovery cannot enumerate all registrations.",
              }),
            );
            for (const [name, implementation] of mapping) {
              const implementationSymbol =
                ts.isIdentifier(implementation) &&
                ts.isShorthandPropertyAssignment(implementation.parent)
                  ? (checker.getShorthandAssignmentValueSymbol(implementation.parent) ??
                    symbol(checker, implementation))
                  : symbol(checker, implementation);
              const declaration = implementationSymbol?.valueDeclaration ?? implementation;
              const owner = fileEntries.get(declaration.getSourceFile().fileName) ?? entry;
              if (callable(checker, implementation) || ts.isMethodDeclaration(implementation))
                definitions.push({
                  id: `${scope}:activity:${name}`,
                  source: location(context, implementation),
                  entryId: owner.id,
                  language: "typescript",
                  kind: "activity",
                  symbol: implementation.getText(),
                  identity: { name, state: "resolved" },
                  registrationScope: scope,
                  construction: {
                    symbol: activities.getText(),
                    reason:
                      "Application-owned Worker activities mapping; preserve closures, bound receivers, and factory dependencies.",
                  },
                });
              else
                diagnostics.push({
                  code: "typescript.activity-not-callable",
                  severity: "warning",
                  source: location(context, implementation),
                  message: `Activity mapping value ${name} is not statically callable. The native SDK registers function values only; resolve its type to establish registration.`,
                });
            }
          }
          const workflowsPath = properties.get("workflowsPath");
          if (workflowsPath && ts.isExpression(workflowsPath)) {
            const bundle = bundleSource(current, workflowsPath);
            const bundleSymbol = bundle && checker.getSymbolAtLocation(bundle);
            if (bundle && bundleSymbol) {
              sandboxImports(context, current, bundle, diagnostics);
              for (const exported of checker.getExportsOfModule(bundleSymbol)) {
                const target =
                  exported.flags & ts.SymbolFlags.Alias
                    ? checker.getAliasedSymbol(exported)
                    : exported;
                const declaration = target.valueDeclaration ?? target.declarations?.[0];
                if (
                  !declaration ||
                  !checker.getTypeOfSymbolAtLocation(target, declaration).getCallSignatures().length
                )
                  continue;
                const owner =
                  fileEntries.get(declaration.getSourceFile().fileName) ??
                  fileEntries.get(bundle.fileName) ??
                  entry;
                definitions.push({
                  id: `${scope}:workflow:${exported.name}`,
                  source: location(context, declaration),
                  entryId: owner.id,
                  language: "typescript",
                  kind: "workflow",
                  symbol: exported.name,
                  identity:
                    exported.name === "default"
                      ? { state: "dynamic", reason: "Native default Workflow fallback." }
                      : { name: exported.name, state: "resolved" },
                  registrationScope: scope,
                });
              }
            } else
              diagnostics.push({
                code: "typescript.workflow-path-unresolved",
                severity: "warning",
                source: location(context, workflowsPath),
                message:
                  "Workflow module path cannot be resolved statically. Preserve the authored workflowsPath and native bundler configuration; its registration scope remains unresolved.",
              });
          }
          const services = properties.get("nexusServices");
          if (services && ts.isExpression(services)) {
            const array = value(checker, services);
            if (ts.isArrayLiteralExpression(array)) {
              for (const [index, service] of array.elements.entries()) {
                if (ts.isSpreadElement(service)) {
                  diagnostics.push({
                    code: "typescript.nexus-array-unresolved",
                    severity: "warning",
                    source: location(context, service),
                    message:
                      "Nexus service array spread requires native assembly; its complete service set is unresolved.",
                  });
                  continue;
                }
                const name = serviceName(checker, service);
                definitions.push({
                  id: `${scope}:nexus:${index}`,
                  source: location(context, service),
                  entryId: entry.id,
                  language: "typescript",
                  kind: "nexus",
                  symbol: service.getText(),
                  registrationScope: scope,
                  identity: name
                    ? { name, state: "resolved" }
                    : {
                        state: "unresolved",
                        reason:
                          "Native Nexus service identity is computed or supplied by application construction.",
                      },
                  construction: {
                    symbol: service.getText(),
                    reason: "Reuse the native service handler and its operation handlers.",
                  },
                });
              }
            } else
              diagnostics.push({
                code: "typescript.nexus-array-unresolved",
                severity: "warning",
                source: location(context, services),
                message:
                  "Nexus services are supplied dynamically. Keep native application assembly; static coverage is incomplete.",
              });
          }
          if (properties.has("workflowBundle"))
            diagnostics.push({
              code: "typescript.native-workflow-bundle",
              severity: "info",
              source: location(context, node),
              message:
                "Authored workflowBundle is preserved. Its exports and sandbox dependencies remain the responsibility of the native bundle build.",
            });
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return { definitions, nativeAssembly };
}
