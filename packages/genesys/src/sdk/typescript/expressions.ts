import ts from "typescript-compiler";
import { slash } from "./compiler.js";

export function symbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  let found =
    ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
  if (found && found.flags & ts.SymbolFlags.Alias) found = checker.getAliasedSymbol(found);
  return found;
}

export function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    node = node.expression;
  return node;
}

export function value(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen = new Set<ts.Node>(),
): ts.Expression {
  const node = unwrap(expression);
  if (seen.has(node)) return node;
  seen.add(node);
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const declaration = symbol(
      checker,
      ts.isPropertyAccessExpression(node) ? node.name : node,
    )?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const
    ) {
      return value(checker, declaration.initializer, seen);
    }
  }
  return node;
}

export function literal(checker: ts.TypeChecker, expression?: ts.Expression): string | undefined {
  if (!expression) return;
  const node = value(checker, expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  const type = checker.getTypeAtLocation(node);
  if (type.isStringLiteral()) return type.value;
  return;
}

function propertyName(checker: ts.TypeChecker, name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name)) return literal(checker, name.expression);
  return;
}

export function native(
  checker: ts.TypeChecker,
  node: ts.Expression,
  packageName: string,
  exportName: string,
): boolean {
  const found = symbol(checker, ts.isPropertyAccessExpression(node) ? node.name : node);
  if (
    found?.name === exportName &&
    found.declarations?.some(
      (d) =>
        slash(d.getSourceFile().fileName).includes(`/node_modules/${packageName}/`) ||
        slash(d.getSourceFile().fileName).includes(
          `/node_modules/.pnpm/${packageName.replace("/", "+")}@`,
        ),
    )
  )
    return true;
  const local = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(node) ? node.expression : node,
  );
  return !!local?.declarations?.some((declaration) => {
    if (ts.isImportSpecifier(declaration)) {
      const importNode = declaration.parent.parent.parent;
      return (
        ts.isStringLiteral(importNode.moduleSpecifier) &&
        importNode.moduleSpecifier.text === packageName &&
        (declaration.propertyName ?? declaration.name).text === exportName
      );
    }
    if (ts.isBindingElement(declaration) && ts.isVariableDeclaration(declaration.parent.parent)) {
      const initializer = declaration.parent.parent.initializer;
      return (
        !!initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "require" &&
        literal(checker, initializer.arguments[0]) === packageName &&
        (declaration.propertyName ?? declaration.name).getText() === exportName
      );
    }
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isPropertyAccessExpression(node)
    ) {
      const initializer = unwrap(declaration.initializer);
      if (
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "require" &&
        literal(checker, initializer.arguments[0]) === packageName &&
        node.name.text === exportName
      )
        return true;
    }
    if (ts.isNamespaceImport(declaration) && ts.isPropertyAccessExpression(node)) {
      const importNode = declaration.parent.parent;
      return (
        ts.isStringLiteral(importNode.moduleSpecifier) &&
        importNode.moduleSpecifier.text === packageName &&
        node.name.text === exportName
      );
    }
    return false;
  });
}

export function objectProperties(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  unresolved: (node: ts.Node) => void,
  seen = new Set<ts.Node>(),
): Map<string, ts.Node> {
  const node = value(checker, expression);
  const result = new Map<string, ts.Node>();
  if (seen.has(node)) {
    unresolved(node);
    return result;
  }
  seen.add(node);
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        for (const [name, implementation] of objectProperties(
          checker,
          property.expression,
          unresolved,
          new Set(seen),
        ))
          result.set(name, implementation);
      } else {
        const name = propertyName(checker, property.name);
        if (name === undefined) {
          unresolved(property);
          continue;
        }
        result.set(
          name,
          ts.isPropertyAssignment(property)
            ? property.initializer
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : property,
        );
      }
    }
  } else {
    const type = checker.getTypeAtLocation(node);
    if (type.getSymbol()?.flags && type.getSymbol()!.flags & ts.SymbolFlags.Class) {
      unresolved(node);
      return result;
    }
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || type.getStringIndexType())
      unresolved(node);
    for (const member of type.getProperties()) {
      const declaration = member.valueDeclaration ?? member.declarations?.[0];
      if (declaration && checker.getTypeOfSymbolAtLocation(member, node).getCallSignatures().length)
        result.set(member.name, declaration);
    }
    if (!result.size) unresolved(node);
  }
  return result;
}

export function callable(checker: ts.TypeChecker, node: ts.Node): boolean {
  return checker.getTypeAtLocation(node).getCallSignatures().length > 0;
}

export function serviceName(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): string | undefined {
  const node = value(checker, expression);
  if (
    (ts.isNewExpression(node) && native(checker, node.expression, "nexus-rpc", "ServiceHandler")) ||
    (ts.isCallExpression(node) && native(checker, node.expression, "nexus-rpc", "serviceHandler"))
  ) {
    const service = node.arguments?.[0];
    if (!service) return;
    const definition = value(checker, service);
    if (
      (ts.isCallExpression(definition) &&
        native(checker, definition.expression, "nexus-rpc", "service")) ||
      (ts.isCallExpression(definition) &&
        native(checker, definition.expression, "nexus-rpc", "defineService"))
    ) {
      const options = definition.arguments[0];
      if (options && native(checker, definition.expression, "nexus-rpc", "service"))
        return literal(checker, options);
      if (options) {
        const name = objectProperties(checker, options, () => {}).get("name");
        if (name && ts.isExpression(name)) return literal(checker, name);
      }
    }
    const type = checker.getTypeAtLocation(service);
    const name = type.getProperty("name");
    if (name) {
      const nameType = checker.getTypeOfSymbolAtLocation(name, service);
      if (nameType.isStringLiteral()) return nameType.value;
    }
  }
  return;
}

export function isService(checker: ts.TypeChecker, node: ts.Expression): boolean {
  const expression = value(checker, node);
  return (
    ((ts.isNewExpression(expression) || ts.isCallExpression(expression)) &&
      (native(checker, expression.expression, "nexus-rpc", "ServiceHandler") ||
        native(checker, expression.expression, "nexus-rpc", "serviceHandler"))) ||
    !!checker
      .getTypeAtLocation(node)
      .getSymbol()
      ?.declarations?.some(
        (declaration) =>
          slash(declaration.getSourceFile().fileName).includes("/nexus-rpc/") &&
          ts.isClassDeclaration(declaration) &&
          declaration.name?.text === "ServiceHandler",
      )
  );
}
