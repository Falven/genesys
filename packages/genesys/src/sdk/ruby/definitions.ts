import type { AnalysisContext, Definition, Diagnostic } from "../../contracts.js";
import {
  constant,
  invocation,
  keywords,
  literal,
  type Invocation,
  type ParsedFile,
  type RubyClass,
} from "./source.js";

function resolveSymbols(files: ParsedFile[]) {
  const classes = files.flatMap((file) => file.classes);
  const assignments = files.flatMap((file) => file.assignments);
  const byName = new Map(classes.map((item) => [item.symbol, item]));
  function resolveName(name: string | undefined, namespace: string[]): string | undefined {
    if (!name) return undefined;
    if (name.startsWith("::")) return name.slice(2);
    for (let length = namespace.length; length >= 0; length--) {
      const candidate = [...namespace.slice(0, length), name].join("::");
      if (byName.has(candidate) || assignments.some((item) => item.symbol === candidate))
        return candidate;
    }
    return name;
  }
  function nativeKind(
    item: RubyClass,
    seen = new Set<string>(),
  ): "workflow" | "activity" | undefined {
    if (seen.has(item.symbol)) return undefined;
    seen.add(item.symbol);
    let parent = resolveName(item.parent, item.namespace);
    const alias = assignments.find((assignment) => assignment.symbol === parent);
    if (alias) parent = resolveName(constant(alias.value), alias.namespace);
    if (parent === "Temporalio::Workflow::Definition") return "workflow";
    if (parent === "Temporalio::Activity::Definition") return "activity";
    const superclass = parent && byName.get(parent);
    return superclass ? nativeKind(superclass, seen) : undefined;
  }
  function needsInstance(item: RubyClass, seen = new Set<string>()): boolean {
    if (seen.has(item.symbol)) return true;
    seen.add(item.symbol);
    if (item.initializer) return item.required;
    let parent = resolveName(item.parent, item.namespace);
    const alias = assignments.find((assignment) => assignment.symbol === parent);
    if (alias) parent = resolveName(constant(alias.value), alias.namespace);
    const superclass = parent && byName.get(parent);
    return superclass ? needsInstance(superclass, seen) : false;
  }
  return { classes, assignments, resolveName, nativeKind, needsInstance };
}

function identity(
  kind: string,
  name: string,
  calls: Invocation[],
  uncertain: boolean,
): Definition["identity"] {
  const names = calls.filter((call) => call.name === `${kind}_name`);
  const dynamics = calls.filter((call) => call.name === `${kind}_dynamic`);
  const named = names.length
    ? literal(names.at(-1)!.args[0])
    : { known: true, value: name.split("::").at(-1) };
  const dynamic = dynamics.length
    ? dynamics.at(-1)!.args.length
      ? literal(dynamics.at(-1)!.args[0])
      : { known: true, value: true }
    : { known: true, value: false };
  if (uncertain || !named.known || !dynamic.known)
    return {
      state: "unresolved",
      reason: "Native naming depends on source expressions or conditional class configuration.",
    };
  if (dynamic.value)
    return { state: "dynamic", reason: "Native catch-all definition has no fixed name." };
  if (typeof named.value !== "string")
    return { state: "unresolved", reason: "Native name is not a literal String or Symbol." };
  return { state: "resolved", name: named.value };
}

export function analyzeDefinitions(context: AnalysisContext, files: ParsedFile[]) {
  const definitions: Definition[] = [];
  const diagnostics: Diagnostic[] = [];
  const inputs = new Set<string>();
  const { classes, assignments, nativeKind, needsInstance, resolveName } = resolveSymbols(files);
  const entries = new Map(
    context.entries
      .filter((entry) => entry.language === "ruby")
      .map((entry) => [entry.path, entry]),
  );
  for (const item of classes) {
    const entry = entries.get(item.path);
    if (!entry || entry.role === "worker") continue;
    const kind = nativeKind(item);
    if (!kind) {
      if (item.parent)
        diagnostics.push({
          code: "ruby.inheritance-unresolved",
          severity: "warning",
          source: { path: item.path, line: item.line },
          message: `${item.symbol}: superclass is not a statically resolved native Temporal definition. Preserve explicit native assembly.`,
        });
      continue;
    }
    const reopened = classes.filter((other) => other.symbol === item.symbol).length > 1;
    if (definitions.some((definition) => definition.id === `${entry.id}#${item.symbol}`)) continue;
    const definition: Definition = {
      id: `${entry.id}#${item.symbol}`,
      source: { path: item.path, line: item.line },
      entryId: entry.id,
      language: "ruby",
      kind,
      symbol: item.symbol,
      identity: identity(
        kind,
        item.symbol,
        item.calls,
        item.conditional || item.uncertain || reopened,
      ),
    };
    const privateConstant = files.some((file) => file.private_constants.includes(item.symbol));
    if (
      item.conditional ||
      reopened ||
      privateConstant ||
      (kind === "activity" && needsInstance(item))
    ) {
      definition.construction = {
        symbol: item.symbol,
        reason: privateConstant
          ? "Private constant requires native lexical access."
          : item.conditional || reopened
            ? "Conditional or reopened class requires explicit native assembly."
            : "Activity constructor requires application-owned arguments or an existing instance.",
      };
    }
    if (kind === "activity" && !item.conditional && !reopened && !privateConstant) {
      const instances = assignments.filter((assignment) => {
        const call = invocation(assignment.value);
        return (
          assignment.path === item.path &&
          !assignment.conditional &&
          call?.name === "new" &&
          resolveName(call.receiver, assignment.namespace) === item.symbol &&
          !files.some((file) => file.private_constants.includes(assignment.symbol))
        );
      });
      if (instances.length === 1) {
        definition.symbol = instances[0]!.symbol;
        delete definition.construction;
      } else if (instances.length > 1) {
        definition.construction = {
          symbol: item.symbol,
          reason:
            "Several application-owned instances exist; native Worker assembly must select one.",
        };
      }
      if (definition.construction) inputs.add(definition.id);
    }
    definitions.push(definition);
  }
  for (const item of assignments) {
    const entry = entries.get(item.path);
    const call = invocation(item.value);
    if (!entry || entry.role === "worker" || !call || call.name !== "new") continue;
    const receiver = resolveName(call.receiver, item.namespace);
    if (receiver !== "Temporalio::Activity::Definition::Info") continue;
    const name = literal(keywords(call.args).name);
    const privateConstant = files.some((file) => file.private_constants.includes(item.symbol));
    definitions.push({
      id: `${entry.id}#${item.symbol}`,
      entryId: entry.id,
      source: { path: item.path, line: item.line },
      language: "ruby",
      kind: "activity",
      symbol: item.symbol,
      identity:
        name.known && !item.conditional
          ? name.value === null
            ? { state: "dynamic" }
            : typeof name.value === "string"
              ? { state: "resolved", name: name.value }
              : { state: "unresolved", reason: "Invalid native Info name." }
          : { state: "unresolved", reason: "Native Info name is computed." },
      ...(item.conditional || privateConstant
        ? {
            construction: {
              symbol: item.symbol,
              reason: "Conditional or private native Info requires explicit assembly.",
            },
          }
        : {}),
    });
  }
  for (const definition of definitions) {
    if (definition.identity.state === "unresolved" || definition.construction)
      diagnostics.push({
        code: inputs.has(definition.id)
          ? "ruby.instance-required"
          : definition.construction
            ? "ruby.native-assembly-required"
            : "ruby.identity-unresolved",
        severity: inputs.has(definition.id) ? "info" : "warning",
        source: definition.source,
        message: inputs.has(definition.id)
          ? `${definition.symbol}: pass an application-owned instance to generated activities(...). Native construction stays in the Worker program.`
          : `${definition.symbol}: ${definition.construction?.reason ?? definition.identity.reason}`,
      });
  }
  for (const entry of entries.values()) {
    if (entry.role === "nexus")
      diagnostics.push({
        code: "ruby.sdk-nexus-unavailable",
        severity: "warning",
        source: { path: entry.path },
        message:
          "Temporal Ruby SDK 1.11.0 has no Nexus service registration API (Worker sets enable_nexus: false). This is an SDK feature limit.",
      });
    if (
      entry.role !== "worker" &&
      !definitions.some((item) => item.entryId === entry.id) &&
      entry.role !== "nexus"
    )
      diagnostics.push({
        code: "ruby.no-static-definition",
        severity: "warning",
        source: { path: entry.path },
        message:
          "No native definition was resolved in this entry. Runtime factories, mixins and metaprogramming retain explicit native assembly.",
      });
  }
  return { definitions, diagnostics, requiredInstances: inputs, resolveName };
}
