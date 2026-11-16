import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Engine } from "php-parser";
import { parseDocument } from "yaml";
import type {
  AnalysisContext,
  AnalysisResult,
  Definition,
  Diagnostic,
  EmitContext,
  EmissionResult,
  NativeAdapter,
  SourceEntry,
  SourceLocation,
} from "../contracts.js";

// php-parser's public types omit several PHP 8 attribute and inheritance fields.
interface Node {
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
interface ClassInfo {
  node: Node;
  symbol: string;
  path: string;
  namespace: string;
  imports: Map<string, string>;
  conditional: boolean;
}
const WORKFLOW = "temporal\\workflow\\workflowinterface";
const ACTIVITY = "temporal\\activity\\activityinterface";
const WORKFLOW_METHOD = "temporal\\workflow\\workflowmethod";
const ACTIVITY_METHOD = "temporal\\activity\\activitymethod";
const name = (node: Node | string | undefined): string =>
  typeof node === "string" ? node : node ? name(node.name) : "";
const body = (node: Node): Node[] => (Array.isArray(node.body) ? node.body : []);
const location = (path: string, node?: Node): SourceLocation => ({
  path,
  ...(node?.loc ? { line: node.loc.start.line, column: node.loc.start.column + 1 } : {}),
});
const within = (path: string, root: string): boolean => root === "." || path.startsWith(`${root}/`);
const packagePath = (context: AnalysisContext, file: string): string =>
  posix.join(context.package.root, file);
const artifactPath = (context: AnalysisContext, root: string): string =>
  `.gsys/compile/php/${createHash("sha256").update(`${context.package.id}:${root}`).digest("hex").slice(0, 16)}/registration.php`;

function resolveName(value: Node | string, info: Pick<ClassInfo, "namespace" | "imports">): string {
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
function attribute(node: Node, info: ClassInfo, target: string): Node | undefined {
  return node.attrGroups
    ?.flatMap((group) => group.attrs ?? [])
    .find((attr) => resolveName(name(attr), info).toLowerCase() === target);
}
function argument(attr: Node | undefined, key: string, fallback: string): Definition["identity"] {
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
function nestedPackageRoots(context: AnalysisContext): string[] {
  return [...context.sources.keys()]
    .filter(
      (path) =>
        posix.basename(path) === "composer.json" &&
        posix.dirname(path) !== context.package.root &&
        within(path, context.package.root),
    )
    .map((path) => posix.dirname(path));
}
function classIndex(context: AnalysisContext, diagnostics: Diagnostic[]): Map<string, ClassInfo> {
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

function analyzeDefinitions(context: AnalysisContext, diagnostics: Diagnostic[]): Definition[] {
  const classes = classIndex(context, diagnostics);
  const entries = new Map(context.entries.map((entry) => [entry.path, entry]));
  const definitions: Definition[] = [];
  for (const info of classes.values()) {
    const entry = entries.get(info.path);
    if (
      !entry ||
      entry.role === "worker" ||
      entry.role === "nexus" ||
      info.node.kind !== "class" ||
      info.node.isAbstract
    )
      continue;
    const unresolved: string[] = [];
    const seen = new Set<string>();
    // Native reader traverses the class, interfaces/traits, then base classes.
    function hierarchy(current: ClassInfo): ClassInfo[] {
      if (seen.has(current.symbol.toLowerCase())) return [];
      seen.add(current.symbol.toLowerCase());
      const traits = body(current.node).filter((node) => node.kind === "traituse");
      if (traits.some((node) => node.adaptations?.length))
        unresolved.push("trait alias or conflict adaptation");
      const parents = Array.isArray(current.node.extends)
        ? current.node.extends
        : current.node.extends
          ? [current.node.extends]
          : [];
      const relatives = [
        ...traits.flatMap((node) => node.traits ?? []),
        ...(current.node.implements ?? []),
        ...parents,
      ];
      return [
        current,
        ...relatives.flatMap((node) => {
          const symbol = resolveName(node, current);
          const relative = classes.get(symbol.toLowerCase());
          if (!relative) {
            unresolved.push(`unavailable ancestor ${symbol}`);
            return [];
          }
          return hierarchy(relative);
        }),
      ];
    }
    const graph = hierarchy(info);
    if (info.conditional) unresolved.push("conditional class declaration");
    if (unresolved.length) {
      diagnostics.push({
        code: "php.unresolved-hierarchy",
        severity: "warning",
        source: location(info.path, info.node),
        message: `${info.symbol}: ${unresolved.join(", ")}. Preserve explicit native assembly; no partial registration is generated.`,
      });
      continue;
    }
    const workflowInterfaces = graph.filter((item) => attribute(item.node, item, WORKFLOW));
    const workflowInterface = workflowInterfaces[0];
    const activityInterfaces = graph.filter((item) => attribute(item.node, item, ACTIVITY));
    if (!workflowInterface && !activityInterfaces.length) continue;
    const methods = new Map<string, { node: Node; owner: ClassInfo }[]>();
    for (const owner of graph)
      for (const method of body(owner.node).filter((node) => node.kind === "method")) {
        const key = name(method).toLowerCase();
        methods.set(key, [...(methods.get(key) ?? []), { node: method, owner }]);
      }
    const append = (
      kind: Definition["kind"],
      method: Node | undefined,
      identity: Definition["identity"],
      suffix: string,
      sourcePath = info.path,
    ): void => {
      definitions.push({
        id: `${entry.id}#${info.symbol}${suffix}`,
        source: location(sourcePath, method ?? info.node),
        entryId: entry.id,
        language: "php",
        kind,
        symbol: kind === "workflow" ? info.symbol : `${info.symbol}::${name(method)}`,
        identity,
        ...(kind === "activity"
          ? {
              construction: {
                symbol: info.symbol,
                reason:
                  "Pass the authored native registerActivity ReflectionClass factory to generated registration; no application instance is constructed during analysis.",
              },
            }
          : {}),
      });
    };
    if (entry.role === "workflow" && workflowInterface) {
      const handlers = [...methods.values()].flatMap((chain) => {
        const root = chain[0]!;
        if (["private", "protected"].includes(root.node.visibility ?? "") || root.node.isStatic)
          return [];
        const attributed = [...chain]
          .reverse()
          .find((item) => attribute(item.node, item.owner, WORKFLOW_METHOD));
        return attributed ? [{ root, attributed, chain }] : [];
      });
      if (handlers.length > 1)
        diagnostics.push({
          code: "php.workflow-handlers",
          severity: "error",
          source: location(info.path, info.node),
          message: `${info.symbol} has multiple Workflow entry methods.`,
        });
      else if (handlers.length === 0)
        append("workflow", undefined, { state: "resolved", name: info.symbol }, "");
      else {
        const { attributed, chain } = handlers[0]!;
        let identity = argument(
          attribute(attributed.node, attributed.owner, WORKFLOW_METHOD),
          "name",
          workflowInterface.symbol.split("\\").at(-1)!,
        );
        const declarations = chain.filter((item) =>
          attribute(item.node, item.owner, WORKFLOW_METHOD),
        );
        if (declarations.length > 1 || workflowInterfaces.length > 1) {
          identity = {
            state: "unresolved",
            reason:
              "Multiple inherited Workflow metadata declarations require the native reader's precedence; generated registration preserves native resolution.",
          };
        }
        append("workflow", info.node, identity, "");
      }
    }
    if (entry.role === "activity" && activityInterfaces.length) {
      const identities = new Map<string, string>();
      for (const chain of methods.values()) {
        const root = chain[0]!;
        const prototypes = new Map<string, Definition["identity"]>();
        for (const item of [...chain].reverse()) {
          const iface = attribute(item.owner.node, item.owner, ACTIVITY);
          if (!iface) continue;
          const attr = attribute(item.node, item.owner, ACTIVITY_METHOD);
          if (["private", "protected"].includes(item.node.visibility ?? "") || item.node.isStatic) {
            if (attr)
              diagnostics.push({
                code: "php.activity-visibility",
                severity: "error",
                source: location(item.owner.path, item.node),
                message: "Activity methods must be public and non-static.",
              });
            continue;
          }
          if (!attr && name(item.node).startsWith("__")) continue;
          const prefix = argument(iface, "prefix", "");
          const methodName = argument(attr, "name", name(item.node));
          const identity: Definition["identity"] =
            prefix.state === "resolved" && methodName.state === "resolved"
              ? { state: "resolved", name: `${prefix.name}${methodName.name}` }
              : { state: "unresolved", reason: prefix.reason ?? methodName.reason };
          prototypes.set(identity.name ?? `${item.owner.symbol}:${name(item.node)}`, identity);
        }
        for (const [key, identity] of prototypes) {
          const previous = identities.get(key);
          if (previous && previous !== name(root.node))
            diagnostics.push({
              code: "php.activity-collision",
              severity: "error",
              source: location(info.path, root.node),
              message: `${info.symbol} maps ${previous} and ${name(root.node)} to Activity ${key}.`,
            });
          identities.set(key, name(root.node));
          append("activity", root.node, identity, `::${name(root.node)}:${key}`, root.owner.path);
        }
      }
    }
  }
  for (const entry of context.entries) {
    if (entry.role === "nexus")
      diagnostics.push({
        code: "php.sdk.nexus-unavailable",
        severity: "warning",
        source: { path: entry.path },
        message:
          "temporal/sdk v2.20 has no public Nexus service registration API. Nexus Worker options do not implement service handlers. No Nexus registration is generated.",
      });
    else if (
      entry.role !== "worker" &&
      !definitions.some((definition) => definition.entryId === entry.id)
    )
      diagnostics.push({
        code: "php.no-concrete-definition",
        severity: "info",
        source: { path: entry.path },
        message:
          "No statically complete concrete native definition found. Interfaces, abstract classes, annotations, conditional declarations and external ancestors may require explicit native assembly.",
      });
  }
  return definitions;
}

function registrationGroups(context: AnalysisContext, definitions: Definition[]) {
  const roots = [
    ...new Set(
      context.entries
        .filter((entry) => entry.role !== "worker")
        .map((entry) => entry.discoveryRoot),
    ),
  ].sort();
  return roots.flatMap((root) => {
    const ids = new Set(
      context.entries.filter((entry) => entry.discoveryRoot === root).map((entry) => entry.id),
    );
    const selected = definitions.filter(
      (definition) => definition.language === "php" && ids.has(definition.entryId),
    );
    if (!selected.length) return [];
    const names = selected.flatMap((definition) =>
      definition.identity.state === "resolved"
        ? [`${definition.kind}:${definition.identity.name}`]
        : [],
    );
    return [{ root, definitions: selected, collision: new Set(names).size !== names.length }];
  });
}

function workers(
  context: AnalysisContext,
  diagnostics: Diagnostic[],
  definitions: Definition[],
): AnalysisResult["workers"] {
  const result: AnalysisResult["workers"] = [];
  const nativeFiles = [
    ...new Set([
      ...context.entries.map((entry) => entry.path),
      ...registrationGroups(context, definitions)
        .filter((group) => !group.collision)
        .map(({ root }) => artifactPath(context, root)),
    ]),
  ].sort();
  const nestedPackages = nestedPackageRoots(context);
  const configs = [...context.sources].filter(
    ([path]) =>
      within(path, context.package.root) &&
      !nestedPackages.some((root) => within(path, root)) &&
      [".rr.yaml", ".rr.yml"].includes(posix.basename(path)),
  );
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of context.entries.filter(
    (entry) => entry.role === "worker" && entry.workerName,
  ))
    groups.set(entry.workerName!, [...(groups.get(entry.workerName!) ?? []), entry]);
  for (const [path] of configs) {
    const parts = path.split("/");
    const index = parts.lastIndexOf("workers");
    const workerName = index >= 0 && parts.length > index + 2 ? parts[index + 1] : undefined;
    if (workerName && !groups.has(workerName))
      groups.set(workerName, [
        {
          id: path,
          path,
          discoveryRoot: parts.slice(0, index + 1).join("/"),
          role: "worker",
          language: "php",
          packageId: context.package.id,
          workerName,
        },
      ]);
  }
  for (const [workerName, entries] of groups) {
    const workerDirectory = entries[0]!.path
      .split("/")
      .slice(0, entries[0]!.path.split("/").lastIndexOf("workers") + 2)
      .join("/");
    const candidates = configs.filter(
      ([path]) =>
        posix.dirname(path) === workerDirectory || posix.dirname(path) === context.package.root,
    );
    const local = candidates.filter(([path]) => posix.dirname(path) === workerDirectory);
    const selected = local.length ? local : candidates;
    const worker: AnalysisResult["workers"][number] = {
      id: `${context.package.id}:${workerName}`,
      name: workerName,
      language: "php",
      packageId: context.package.id,
      source: { path: entries[0]!.path },
      build: [
        {
          executable: "composer",
          args: ["install", "--no-interaction"],
          cwd: context.package.root,
        },
        ...nativeFiles.map((path) => ({
          executable: "php",
          args: ["-l", posix.relative(context.package.root, path)],
          cwd: context.package.root,
        })),
      ],
      readiness: {
        state: "unavailable",
        description:
          "RoadRunner owns Temporal pollers. Its pool Ready status and PHP WorkerFactory::run do not prove polling. Attribute native Worker heartbeats to the RoadRunner host PID and generation, then require fresh successful polls for each known task type. Dynamic Worker coverage and versioning can remain unknown.",
        evidence: [
          "RoadRunner host PID and start time",
          "native Worker heartbeat",
          "last_successful_poll_time",
          "native deployment drainage (retirement only)",
        ],
      },
    };
    if (selected.length !== 1 || (local.length === 0 && groups.size > 1)) {
      diagnostics.push({
        code: "php.worker-entrypoint",
        severity: "warning",
        source: worker.source,
        related: selected.map(([path]) => ({ path })),
        message: `Worker ${workerName} needs one unambiguous native RoadRunner config. Use a native executable override for unresolved launch environments; PHP scripts alone do not own pollers.`,
      });
    } else {
      const [path, content] = selected[0]!;
      try {
        const document = parseDocument(content, { uniqueKeys: true });
        if (document.errors.length) throw document.errors[0];
        const config = document.toJS({ maxAliasCount: 100 }) as {
          temporal?: unknown;
          server?: { command?: unknown };
        } | null;
        if (
          !config ||
          typeof config.temporal !== "object" ||
          !config.temporal ||
          typeof config.server?.command !== "string"
        )
          throw new Error("RoadRunner temporal configuration and server.command are required.");
        worker.start = {
          executable: "rr",
          args: ["serve", "-c", posix.basename(path)],
          cwd: posix.dirname(path),
        };
        worker.source = { path };
      } catch (error) {
        diagnostics.push({
          code: "php.roadrunner-config",
          severity: "warning",
          source: { path },
          message: `Cannot resolve native RoadRunner launch: ${String(error)}. Preserve native configuration and use an executable override.`,
        });
      }
    }
    result.push(worker);
  }
  return result;
}

export const phpAdapter: NativeAdapter = {
  language: "php",
  async analyze(context): Promise<AnalysisResult> {
    const diagnostics: Diagnostic[] = [];
    let version: string | undefined;
    try {
      const lock = context.sources.get(packagePath(context, "composer.lock"));
      if (lock)
        version = (
          JSON.parse(lock) as { packages?: { name: string; version: string }[] }
        ).packages?.find((pkg) => pkg.name === "temporal/sdk")?.version;
      const manifest = JSON.parse(
        context.sources.get(packagePath(context, "composer.json")) ?? "{}",
      ) as { require?: Record<string, string> };
      if (!manifest.require?.["temporal/sdk"])
        diagnostics.push({
          code: "php.sdk-dependency",
          severity: "warning",
          source: { path: packagePath(context, "composer.json") },
          message:
            "temporal/sdk is not a direct Composer runtime dependency; native package availability requires verification.",
        });
    } catch (error) {
      diagnostics.push({
        code: "php.composer-context",
        severity: "error",
        source: { path: context.package.root },
        message: `Invalid Composer metadata: ${String(error)}`,
      });
    }
    diagnostics.push({
      code: "php.sdk-version",
      severity: "info",
      source: { path: context.package.root },
      message: `Inspected temporal/sdk v2.20 (5180fcd24e8f08fd5955fde7b2eeeae3c018b2e5); Composer lock resolves ${version ?? "no exact SDK version"}. Other versions require native verification. Inspection uses php-parser 3.7.0 and does not execute PHP or Composer. Doctrine annotations and custom metadata readers require explicit native assembly.`,
    });
    const definitions = analyzeDefinitions(context, diagnostics);
    const programs = workers(context, diagnostics, definitions);
    return { definitions, diagnostics, workers: programs };
  },
  async emit(context: EmitContext): Promise<EmissionResult> {
    const artifacts: EmissionResult["artifacts"] = [];
    const diagnostics: Diagnostic[] = [];
    for (const { root, definitions, collision } of registrationGroups(
      context,
      context.analysis.definitions,
    )) {
      const workflowTypes = [
        ...new Set(
          definitions
            .filter((definition) => definition.kind === "workflow")
            .map((definition) => definition.symbol),
        ),
      ].sort();
      const activityTypes = [
        ...new Set(
          definitions
            .filter((definition) => definition.kind === "activity")
            .map((definition) => definition.construction!.symbol),
        ),
      ].sort();
      const path = artifactPath(context, root);
      const lines = [
        "<?php",
        "declare(strict_types=1);",
        "",
        "// Generated by Genesys. Load the application's Composer autoloader first.",
        "// The caller owns the Worker and the native ReflectionClass Activity factory.",
        "return static function (\\Temporal\\Worker\\WorkerInterface $worker, ?callable $activityFactory = null): void {",
        ...workflowTypes.map((type) => `    $worker->registerWorkflowTypes(\\${type}::class);`),
        ...activityTypes.map(
          (type) => `    $worker->registerActivity(\\${type}::class, $activityFactory);`,
        ),
        "};",
        "",
      ];
      const seen = new Map<string, Definition>();
      for (const definition of definitions) {
        if (definition.identity.state !== "resolved") {
          diagnostics.push({
            code: "php.unresolved-identity",
            severity: "warning",
            source: definition.source,
            message: `${definition.symbol}: ${definition.identity.reason} Native registration retains the expression; collision analysis is incomplete.`,
          });
          continue;
        }
        const key = `${definition.kind}:${definition.identity.name}`;
        const previous = seen.get(key);
        if (previous) {
          diagnostics.push({
            code: "php.generated-scope-collision",
            severity: "warning",
            source: definition.source,
            related: [previous.source],
            message: `${key} occurs more than once in the generated registration for ${root}; the ambiguous aggregate is omitted. Use separate native assembly for independent Workers.`,
          });
        } else seen.set(key, definition);
      }
      if (!collision) {
        diagnostics.push({
          code: "php.registration-scope",
          severity: "info",
          source: { path: root },
          message: `${path} registers this discovery root on an authored native Worker. Composer must autoload each concrete class. Worker placement, factory construction, custom metadata and explicit registrations remain application-owned; cross-class identity conflicts depend on that actual Worker scope.`,
        });
        artifacts.push({ path, kind: "registration", content: lines.join("\n") });
      }
    }
    return { artifacts, diagnostics };
  },
};
