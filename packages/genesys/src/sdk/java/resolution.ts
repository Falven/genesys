import type { Annotation, Expression, JavaType } from "./model.js";

const knownAnnotations = new Set([
  "io.temporal.workflow.WorkflowInterface",
  "io.temporal.workflow.WorkflowMethod",
  "io.temporal.workflow.SignalMethod",
  "io.temporal.workflow.QueryMethod",
  "io.temporal.workflow.UpdateMethod",
  "io.temporal.workflow.UpdateValidatorMethod",
  "io.temporal.workflow.WorkflowInit",
  "io.temporal.activity.ActivityInterface",
  "io.temporal.activity.ActivityMethod",
  "io.nexusrpc.Service",
  "io.nexusrpc.Operation",
  "io.nexusrpc.handler.ServiceImpl",
  "io.nexusrpc.handler.OperationImpl",
]);
export function resolveTypes(types: JavaType[]) {
  const index = new Map(types.map((type) => [type.name, type]));
  const known = (name: string) =>
    index.has(name) ||
    knownAnnotations.has(name) ||
    ["io.temporal.workflow.DynamicWorkflow", "io.temporal.activity.DynamicActivity"].includes(name);
  function qualify(name: string, owner: JavaType): string | undefined {
    if (known(name)) return name;
    for (
      let enclosing = owner.name;
      enclosing.includes(".");
      enclosing = enclosing.slice(0, enclosing.lastIndexOf("."))
    ) {
      if (index.has(`${enclosing}.${name}`)) return `${enclosing}.${name}`;
    }
    const local = owner.packageName ? `${owner.packageName}.${name}` : name;
    if (index.has(local)) return local;
    const first = name.split(".")[0]!;
    const explicit = owner.imports.filter((value) => value.endsWith(`.${first}`));
    if (explicit.length === 1) return explicit[0]! + name.slice(first.length);
    if (explicit.length > 1) return undefined;
    const wildcards = owner.imports
      .filter((value) => value.endsWith(".*"))
      .map((value) => `${value.slice(0, -1)}${name}`)
      .filter(known);
    if (wildcards.length === 1) return wildcards[0];
    return undefined;
  }
  function annotation(annotations: Annotation[], name: string, owner: JavaType) {
    return annotations.find((value) => qualify(value.name, owner) === name);
  }
  function value(
    expression: Expression | undefined,
    owner: JavaType,
    seen = new Set<string>(),
  ): string | undefined {
    if (!expression) return "";
    if (expression.literal !== undefined) return expression.literal;
    if (expression.concat) {
      const parts = expression.concat.map((part) => value(part, owner, new Set(seen)));
      return parts.some((part) => part === undefined) ? undefined : parts.join("");
    }
    const reference = expression.reference;
    if (!reference) return undefined;
    let type = owner;
    let field = reference;
    if (reference.includes(".")) {
      field = reference.slice(reference.lastIndexOf(".") + 1);
      const name = qualify(reference.slice(0, reference.lastIndexOf(".")), owner);
      if (!name || !index.has(name)) return undefined;
      type = index.get(name)!;
    } else if (!Object.hasOwn(owner.constants, field)) {
      const imports = owner.staticImports.filter(
        (item) => item.endsWith(`.${field}`) || item.endsWith(".*"),
      );
      const candidates = imports
        .map((item) => index.get(item.slice(0, item.lastIndexOf("."))))
        .filter((item) => item && Object.hasOwn(item.constants, field));
      if (candidates.length !== 1) return undefined;
      type = candidates[0]!;
    }
    const key = `${type.name}.${field}`;
    if (seen.has(key) || !Object.hasOwn(type.constants, field)) return undefined;
    seen.add(key);
    return value(type.constants[field], type, seen);
  }
  return { index, qualify, annotation, value };
}
