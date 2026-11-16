import { Engine } from "php-parser";
import type { AnalysisContext, Definition, Diagnostic, SourceLocation } from "../../contracts.js";
import { posix } from "node:path";

export interface Node {
  kind: string;
  name?: string | Node;
  value?: string | Node;
  children?: Node[];
  body?: Node[] | Node;
  items?: Node[];
  args?: Node[];
  attrs?: Node[];
  attrGroups?: Node[];
  alias?: Node;
  type?: string;
  extends?: Node | Node[];
  implements?: Node[];
  traits?: Node[];
  adaptations?: Node[];
  visibility?: string;
  isStatic?: boolean;
  isAbstract?: boolean;
  isAnonymous?: boolean;
  loc?: { start: { line: number; column: number } };
}
export interface ClassInfo {
  node: Node;
  symbol: string;
  path: string;
  namespace: string;
  imports: Map<string, string>;
  conditional: boolean;
}
export const name = (node: Node | string | undefined): string =>
  typeof node === "string" ? node : node ? name(node.name) : "";
export const body = (node: Node): Node[] => (Array.isArray(node.body) ? node.body : []);
export const location = (path: string, node?: Node): SourceLocation => ({
  path,
  ...(node?.loc ? { line: node.loc.start.line, column: node.loc.start.column + 1 } : {}),
});
export function resolveName(
  value: Node | string,
  info: Pick<ClassInfo, "namespace" | "imports">,
): string {
  const raw = name(value);
  if (raw.startsWith("\\")) return raw.slice(1);
  if (raw.toLowerCase().startsWith("namespace\\"))
    return [info.namespace, raw.slice(10)].filter(Boolean).join("\\");
  const [first, ...rest] = raw.split("\\");
  const imported = info.imports.get(first!.toLowerCase());
  return imported
    ? [imported, ...rest].join("\\")
    : [info.namespace, raw].filter(Boolean).join("\\");
}
export function attribute(node: Node, info: ClassInfo, target: string): Node | undefined {
  return node.attrGroups
    ?.flatMap((group) => group.attrs ?? [])
    .find((attr) => resolveName(name(attr), info).toLowerCase() === target);
}
export function argument(
  attr: Node | undefined,
  key: string,
  fallback: string,
): Definition["identity"] {
  const arg =
    attr?.args?.find((arg) => arg.kind === "namedargument" && name(arg) === key) ??
    attr?.args?.find((arg) => arg.kind !== "namedargument");
  const value = arg?.kind === "namedargument" ? (arg.value as Node) : arg;
  if (!value || value.kind === "nullkeyword") return { state: "resolved", name: fallback };
  if (value.kind === "string" && typeof value.value === "string")
    return { state: "resolved", name: value.value };
  return {
    state: "unresolved",
    reason: `The ${key} attribute argument is not a literal string or null.`,
  };
}
export function classIndex(
  context: AnalysisContext,
  diagnostics: Diagnostic[],
): Map<string, ClassInfo> {
  const classes = new Map<string, ClassInfo>();
  const nestedPackages = nestedPackageRoots(context);
  const parser = new Engine({
    parser: { version: "8.4", extractDoc: true },
    ast: { withPositions: true },
  });
  for (const [path, source] of context.sources) {
    if (
      !path.endsWith(".php") ||
      !within(path, context.package.root) ||
      nestedPackages.some((root) => within(path, root))
    )
      continue;
    let tree: Node;
    try {
      tree = parser.parseCode(source, path) as unknown as Node;
    } catch (error) {
      diagnostics.push({
        code: "php.parse",
        severity: "error",
        source: { path },
        message: String(error),
      });
      continue;
    }
    function scan(
      nodes: Node[],
      namespace: string,
      inheritedImports = new Map<string, string>(),
      conditional = false,
    ): void {
      const imports = new Map(inheritedImports);
      for (const node of nodes) {
        if (node.kind === "usegroup")
          for (const item of node.items ?? []) {
            if (node.type || item.type) continue;
            const full = [name(node), name(item)].filter(Boolean).join("\\");
            imports.set((name(item.alias) || full.split("\\").at(-1)!).toLowerCase(), full);
          }
      }
      for (const node of nodes) {
        if (node.kind === "namespace") {
          scan(node.children ?? [], name(node));
          continue;
        }
        if (["class", "interface", "trait"].includes(node.kind) && !node.isAnonymous) {
          const symbol = [namespace, name(node)].filter(Boolean).join("\\");
          if (classes.has(symbol.toLowerCase()))
            diagnostics.push({
              code: "php.duplicate-symbol",
              severity: "error",
              source: location(path, node),
              message: `Multiple declarations of ${symbol}; static binding is ambiguous.`,
            });
          classes.set(symbol.toLowerCase(), {
            node,
            symbol,
            path,
            namespace,
            imports,
            conditional,
          });
        } else if (node.kind !== "usegroup") {
          for (const [key, child] of Object.entries(node)) {
            if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
            if (Array.isArray(child))
              scan(
                child.filter(
                  (value): value is Node => value && typeof value === "object" && "kind" in value,
                ),
                namespace,
                imports,
                true,
              );
            else if (child && typeof child === "object" && "kind" in child)
              scan([child as Node], namespace, imports, true);
          }
        }
      }
    }
    scan(tree.children ?? [], "");
  }
  return classes;
}

export const within = (path: string, root: string): boolean =>
  root === "." || path.startsWith(`${root}/`);
export function nestedPackageRoots(context: AnalysisContext): string[] {
  return [...context.sources.keys()]
    .filter(
      (path) =>
        posix.basename(path) === "composer.json" &&
        posix.dirname(path) !== context.package.root &&
        within(path, context.package.root),
    )
    .map((path) => posix.dirname(path));
}
