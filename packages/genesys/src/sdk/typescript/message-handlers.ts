import { relative } from "node:path";
import ts from "typescript-compiler";
import type { AnalysisContext, Diagnostic } from "../../contracts.js";
import { location, slash, type CompilerModel } from "./compiler.js";
import { native, objectProperties, symbol, unwrap, value } from "./expressions.js";

export const handlerKey = (node: ts.Node): string => `${node.getSourceFile().fileName}:${node.pos}`;

export function messageHandlers(
  context: AnalysisContext,
  configurations: Iterable<CompilerModel>,
  diagnostics: Diagnostic[],
): Set<string> {
  const messageHandlers = new Set<string>();
  for (const { checker, program } of configurations) {
    const markHandler = (expression: ts.Expression): void => {
      const resolved = value(checker, expression);
      if (ts.isConditionalExpression(resolved)) {
        markHandler(resolved.whenTrue);
        markHandler(resolved.whenFalse);
      }
      for (const reference of [unwrap(expression), resolved]) {
        const target = symbol(
          checker,
          ts.isPropertyAccessExpression(reference) ? reference.name : reference,
        );
        for (const declaration of target?.declarations ?? [])
          messageHandlers.add(handlerKey(declaration));
        if (ts.isArrowFunction(reference) || ts.isFunctionExpression(reference)) {
          messageHandlers.add(handlerKey(reference));
          if (ts.isVariableDeclaration(reference.parent))
            messageHandlers.add(handlerKey(reference.parent));
        }
      }
      if (ts.isIdentifier(resolved) && resolved.text === "undefined") return;
      const target = symbol(
        checker,
        ts.isPropertyAccessExpression(resolved) ? resolved.name : resolved,
      );
      const declaration = target?.valueDeclaration;
      if (
        !ts.isArrowFunction(resolved) &&
        !ts.isFunctionExpression(resolved) &&
        (!declaration ||
          (!ts.isFunctionDeclaration(declaration) && !ts.isMethodDeclaration(declaration)))
      ) {
        diagnostics.push({
          code: "typescript.message-handler-unresolved",
          severity: "warning",
          source: location(context, expression),
          message:
            "Native message handler or validator is not a unique static function. Referenced exports are excluded from automatic registration; retain explicit native assembly.",
        });
      }
    };
    for (const file of program.getSourceFiles()) {
      if (
        file.isDeclarationFile ||
        !context.sources.has(slash(relative(context.projectRoot, file.fileName)))
      )
        continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          native(checker, value(checker, node.expression), "@temporalio/workflow", "setHandler")
        ) {
          if (node.arguments[1]) markHandler(node.arguments[1]);
          const options = node.arguments[2];
          if (options) {
            const properties = objectProperties(checker, options, (unresolved) =>
              diagnostics.push({
                code: "typescript.message-options-unresolved",
                severity: "warning",
                source: location(context, unresolved),
                message:
                  "Native handler options are dynamic; validator references require explicit native assembly.",
              }),
            );
            const validator = properties.get("validator");
            if (validator && ts.isExpression(validator)) markHandler(validator);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return messageHandlers;
}
