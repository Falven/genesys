import type { Definition, Diagnostic, SourceEntry } from "../../contracts.js";
import { location, type JavaType, type Method, type Registration } from "./model.js";
import { resolveTypes } from "./resolution.js";

export function analyzeDefinition(
  type: JavaType,
  entry: SourceEntry & { role: Definition["kind"] },
  resolver: ReturnType<typeof resolveTypes>,
) {
  const result: { definitions: Definition[]; diagnostics: Diagnostic[] } = {
    definitions: [],
    diagnostics: [],
  };
  const registrations: Registration[] = [];
  const { index, qualify, annotation, value } = resolver;
  const add = (
    code: string,
    message: string,
    source: JavaType,
    severity: Diagnostic["severity"] = "warning",
  ) =>
    result.diagnostics.push({ code: `java.${code}`, severity, message, source: location(source) });
  function lineage(type: JavaType, visited = new Set<string>()): JavaType[] {
    if (visited.has(type.name)) return [];
    visited.add(type.name);
    const parents = type.parents.flatMap((name) => {
      const resolved = qualify(name, type);
      const parent = resolved ? index.get(resolved) : undefined;
      if (parent) return lineage(parent, visited);
      if (
        ![
          "Object",
          "java.lang.Object",
          "io.temporal.workflow.DynamicWorkflow",
          "io.temporal.activity.DynamicActivity",
        ].includes(resolved ?? name)
      )
        add(
          "external-ancestor",
          `Cannot resolve ancestor ${name} of ${type.name} from package source. Its native definitions may require explicit native assembly.`,
          type,
        );
      return [];
    });
    return [...parents, type];
  }
  interface ContractMethod {
    owner: JavaType;
    method: Method;
    contract: JavaType;
  }
  function contractMethods(
    type: JavaType,
    kind: "workflow" | "activity",
    seen = new Set<string>(),
  ): { pending: { owner: JavaType; method: Method }[]; found: ContractMethod[] } {
    if (seen.has(type.name)) return { pending: [], found: [] };
    seen.add(type.name);
    const pending: { owner: JavaType; method: Method }[] = [];
    const found: ContractMethod[] = [];
    const ownMethods = type.methods.filter(
      (method) => method.name !== "<init>" && !method.flags.includes("static"),
    );
    for (const name of type.parents) {
      const parent = index.get(qualify(name, type) ?? "");
      if (!parent || parent.kind !== "INTERFACE") continue;
      const inherited = contractMethods(parent, kind, seen);
      found.push(...inherited.found);
      for (const method of inherited.pending) {
        const marked =
          kind === "activity"
            ? annotation(
                method.method.annotations,
                "io.temporal.activity.ActivityMethod",
                method.owner,
              )
            : method.method.annotations.some((item) =>
                [
                  "io.temporal.workflow.WorkflowMethod",
                  "io.temporal.workflow.SignalMethod",
                  "io.temporal.workflow.QueryMethod",
                  "io.temporal.workflow.UpdateMethod",
                  "io.temporal.workflow.UpdateValidatorMethod",
                ].includes(qualify(item.name, method.owner) ?? ""),
              );
        if (
          marked ||
          !ownMethods.some(
            (own) =>
              own.name === method.method.name &&
              own.parameters.join() === method.method.parameters.join(),
          )
        )
          pending.push(method);
      }
    }
    pending.push(...ownMethods.map((method) => ({ owner: type, method })));
    const marker = annotation(
      type.annotations,
      kind === "workflow"
        ? "io.temporal.workflow.WorkflowInterface"
        : "io.temporal.activity.ActivityInterface",
      type,
    );
    if (marker) {
      if (!type.flags.includes("public"))
        add(
          "contract-visibility",
          `${type.name} is an annotated interface without public visibility; native SDK registration rejects this contract.`,
          type,
          "error",
        );
      found.push(...pending.map((item) => ({ ...item, contract: type })));
      return { pending: [], found };
    }
    return { pending, found };
  }
  function definition(
    type: JavaType,
    entry: SourceEntry,
    kind: Definition["kind"],
    key: string,
    name: string | undefined,
    dynamic = false,
    methodName?: string,
  ) {
    result.definitions.push({
      id: `${entry.id}#${type.name}#${kind}#${key}`,
      source: location(type),
      entryId: entry.id,
      language: "java",
      kind,
      symbol:
        kind === "activity" && key !== "dynamic" ? `${type.name}.${methodName ?? key}` : type.name,
      identity: dynamic
        ? { state: "dynamic", reason: "Native catch-all implementation" }
        : name === undefined
          ? {
              state: "unresolved",
              reason: "Native annotation expression cannot be resolved from package source",
            }
          : { state: "resolved", name },
      construction: {
        symbol: type.name,
        reason:
          kind === "workflow"
            ? "Native SDK constructs Workflow instances and owns handler state."
            : "Register one native implementation instance for all of its methods.",
      },
    });
    if (name === undefined && !dynamic)
      add(
        "identity-unresolved",
        `The native identity for ${type.name} (${key}) is unresolved. Registration preserves the native annotations.`,
        type,
      );
  }
  if (["INTERFACE", "ANNOTATION_TYPE"].includes(type.kind) || type.flags.includes("abstract"))
    return { ...result, registrations };
  const ancestors = lineage(type);
  const genericHierarchy = ancestors.some((ancestor) => ancestor.generic);
  if (genericHierarchy)
    add(
      "generic-hierarchy",
      `Generic method substitution for ${type.name} needs native compiler attribution. Its static method identities remain unresolved; native registration retains the implementation and all SDK metadata.`,
      type,
    );
  const interfaces = ancestors.filter((ancestor) => ancestor.kind === "INTERFACE");
  const kind = entry.role;
  const before = result.definitions.length;
  if (kind === "workflow" || kind === "activity") {
    const dynamicType =
      kind === "workflow"
        ? "io.temporal.workflow.DynamicWorkflow"
        : "io.temporal.activity.DynamicActivity";
    if (
      ancestors.some((ancestor) =>
        ancestor.parents.some((parent) => qualify(parent, ancestor) === dynamicType),
      )
    )
      definition(type, entry, kind, "dynamic", undefined, true);
    const methods = interfaces.flatMap((contract) => contractMethods(contract, kind).found);
    const seenMethods = new Set<string>();
    for (const { owner, method, contract } of methods) {
      const key = `${contract.name}#${owner.name}.${method.name}(${method.parameters.join(",")})`;
      if (seenMethods.has(key)) continue;
      seenMethods.add(key);
      if (kind === "workflow") {
        const marker = annotation(method.annotations, "io.temporal.workflow.WorkflowMethod", owner);
        if (!marker) continue;
        const name = value(marker.values.name, owner);
        definition(
          type,
          entry,
          kind,
          key,
          genericHierarchy ? undefined : name === "" ? contract.simple : name,
        );
      } else {
        const marker = annotation(method.annotations, "io.temporal.activity.ActivityMethod", owner);
        const prefix = value(
          annotation(contract.annotations, "io.temporal.activity.ActivityInterface", contract)
            ?.values.namePrefix,
          contract,
        );
        const explicit = value(marker?.values.name, owner);
        definition(
          type,
          entry,
          kind,
          key,
          genericHierarchy
            ? undefined
            : explicit === ""
              ? prefix === undefined
                ? undefined
                : prefix + method.name[0]!.toUpperCase() + method.name.slice(1)
              : explicit,
          false,
          method.name,
        );
      }
    }
  } else {
    const marker = annotation(type.annotations, "io.nexusrpc.handler.ServiceImpl", type);
    if (marker) {
      const serviceName = marker.values.service?.className;
      const contract = serviceName ? index.get(qualify(serviceName, type) ?? "") : undefined;
      const service = contract
        ? annotation(contract.annotations, "io.nexusrpc.Service", contract)
        : undefined;
      const name = contract && service ? value(service.values.name, contract) : undefined;
      definition(type, entry, "nexus", "service", name === "" ? contract?.simple : name);
      if (!contract || !service)
        add(
          "nexus-contract-unresolved",
          `Cannot resolve the @Service contract of ${type.name}; native registration remains responsible for its operation handlers.`,
          type,
        );
    }
  }
  if (result.definitions.length > before) registrations.push({ type, kind, entry });
  else
    add(
      "native-assembly",
      `No ${kind} implementation could be established for ${type.name}. Helpers are not registered. If this is a native definition, retain explicit native assembly.`,
      type,
      "info",
    );

  return { ...result, registrations };
}
