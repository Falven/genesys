import type { AnalysisContext, Definition, Diagnostic } from "../../contracts.js";
import {
  argument,
  attribute,
  body,
  classIndex,
  location,
  name,
  resolveName,
  type ClassInfo,
  type Node,
} from "./source.js";

const WORKFLOW = "temporal\\workflow\\workflowinterface";
const ACTIVITY = "temporal\\activity\\activityinterface";
const WORKFLOW_METHOD = "temporal\\workflow\\workflowmethod";
const ACTIVITY_METHOD = "temporal\\activity\\activitymethod";
export function analyzeDefinitions(
  context: AnalysisContext,
  diagnostics: Diagnostic[],
): Definition[] {
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
