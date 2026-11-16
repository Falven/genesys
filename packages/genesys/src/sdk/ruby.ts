import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";
import type {
  AnalysisContext,
  AnalysisResult,
  Definition,
  Diagnostic,
  EmitContext,
  EmissionResult,
  NativeAdapter,
  SourceEntry,
  WorkerProgram,
} from "../contracts.js";

type Node = unknown[];
interface Invocation {
  name: string;
  args: Node[];
  line: number;
}
interface RubyClass {
  symbol: string;
  parent?: string;
  namespace: string[];
  path: string;
  line: number;
  calls: Invocation[];
  conditional: boolean;
  uncertain: boolean;
  initializer: boolean;
  required: boolean;
}
interface Assignment {
  symbol: string;
  value: Node;
  namespace: string[];
  path: string;
  line: number;
  conditional: boolean;
}
interface ParsedFile {
  path: string;
  error?: string;
  classes: RubyClass[];
  assignments: Assignment[];
  workers: { path: string; line: number; options: Record<string, Node>; namespace: string[] }[];
  runs: number[];
  relative_requires: string[];
  private_constants: string[];
  diagnostics: Diagnostic[];
}

const helper = fileURLToPath(new URL("../../sdk/ruby/discover.rb", import.meta.url));
const inside = (path: string, root: string) => root === "." || path.startsWith(`${root}/`);
const token = (node: unknown): Node => (Array.isArray(node) ? node : []);
const instanceInputs = new WeakMap<AnalysisResult, Set<string>>();

function constant(value: unknown): string | undefined {
  const node = token(value);
  switch (node[0]) {
    case "@const":
      return String(node[1]);
    case "var_ref":
    case "const_ref":
    case "var_field":
      return constant(node[1]);
    case "top_const_ref":
    case "top_const_field":
      return `::${constant(node[1])}`;
    case "const_path_ref":
    case "const_path_field": {
      const left = constant(node[1]);
      return left ? `${left}::${constant(node[2])}` : undefined;
    }
    default:
      return undefined;
  }
}

function literal(value: unknown): { known: boolean; value?: string | boolean | null } {
  const node = token(value);
  if (node[0] === "var_ref") {
    const word = token(node[1])[1];
    if (word === "true" || word === "false" || word === "nil")
      return { known: true, value: word === "nil" ? null : word === "true" };
  }
  if (node[0] === "symbol_literal") {
    const leaf = token(token(node[1])[1]);
    if (["@ident", "@const", "@op"].includes(String(leaf[0])))
      return { known: true, value: String(leaf[1]) };
  }
  if (node[0] === "string_literal" || node[0] === "dyna_symbol") {
    const parts = token(node[1]).slice(1).map(token);
    if (parts.every((part) => part[0] === "@tstring_content")) {
      const text = parts.map((part) => part[1]).join("");
      if (!text.includes("\\")) return { known: true, value: text };
    }
  }
  return { known: false };
}

function invocation(
  value: unknown,
): { receiver?: string; name?: string; args: Node[] } | undefined {
  const node = token(value);
  if (node[0] === "method_add_block") return invocation(node[1]);
  if (node[0] === "method_add_arg") {
    const result = invocation(node[1]);
    let args = token(node[2]);
    if (args[0] === "arg_paren") args = token(args[1]);
    return (
      result && { ...result, args: args[0] === "args_add_block" ? token(args[1]).map(token) : [] }
    );
  }
  if (node[0] === "call" || node[0] === "command_call")
    return {
      receiver: constant(node[1]),
      name: String(token(node[3])[1]),
      args: node[0] === "command_call" ? token(token(node[4])[1]).map(token) : [],
    };
  return undefined;
}

function keywords(args: Node[]): Record<string, Node> {
  const hash = args.find((arg) => arg[0] === "bare_assoc_hash" || arg[0] === "hash");
  if (!hash) return {};
  const pairs = token(hash[0] === "hash" ? token(hash[1])[1] : hash[1]);
  return Object.fromEntries(
    pairs
      .map(token)
      .filter((pair) => pair[0] === "assoc_new" && token(pair[1])[0] === "@label")
      .map((pair) => [String(token(pair[1])[1]).replace(/:$/, ""), token(pair[2])]),
  );
}

async function parse(context: AnalysisContext): Promise<ParsedFile[]> {
  const sources = [...context.sources].filter(
    ([path, source]) => path.endsWith(".rb") || /^#![^\n]*\bruby\b/.test(source),
  );
  const env = { ...process.env };
  delete env.RUBYOPT;
  delete env.RUBYLIB;
  return new Promise((resolve, reject) => {
    const child = spawn("ruby", ["--disable=gems", helper], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Ruby source analysis exceeded 30 seconds."));
    }, 30_000);
    for (const [stream, chunks] of [
      [child.stdout, output],
      [child.stderr, errors],
    ] as const) {
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) {
          child.kill();
          reject(new Error("Ruby source analysis exceeded its 32 MiB output limit."));
        } else chunks.push(chunk);
      });
    }
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(
          new Error(Buffer.concat(errors).toString() || `Ruby parser exited with ${code}.`),
        );
      try {
        resolve((JSON.parse(Buffer.concat(output).toString()) as { files: ParsedFile[] }).files);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ sources }));
  });
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

async function analyze(context: AnalysisContext): Promise<AnalysisResult> {
  const result: AnalysisResult = { definitions: [], diagnostics: [], workers: [] };
  const inputs = new Set<string>();
  instanceInputs.set(result, inputs);
  let files: ParsedFile[];
  try {
    files = await parse(context);
  } catch (error) {
    result.diagnostics.push({
      code: "ruby.parser-unavailable",
      severity: "error",
      message: `Ruby Ripper analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return result;
  }
  const nestedPackages = [...context.sources.keys()]
    .filter(
      (path) =>
        inside(path, context.package.root) &&
        posix.dirname(path) !== context.package.root &&
        (posix.basename(path) === "Gemfile" || path.endsWith(".gemspec")),
    )
    .map(posix.dirname);
  const owned = (path: string) =>
    inside(path, context.package.root) && !nestedPackages.some((root) => inside(path, root));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set(files.filter((file) => owned(file.path)).map((file) => file.path));
  for (const path of included) {
    for (const imported of byPath.get(path)?.relative_requires ?? []) {
      const target = posix.normalize(posix.join(posix.dirname(path), imported));
      const resolved = byPath.has(target) ? target : `${target}.rb`;
      if (byPath.has(resolved)) included.add(resolved);
      else
        result.diagnostics.push({
          code: "ruby.relative-import-unresolved",
          severity: "warning",
          source: { path },
          message: `require_relative ${JSON.stringify(imported)} is outside the static source inventory. Native loading remains authoritative.`,
        });
    }
  }
  files = files.filter((file) => included.has(file.path));
  for (const file of files) {
    if (file.error)
      result.diagnostics.push({
        code: "ruby.syntax",
        severity: "error",
        source: { path: file.path },
        message: file.error,
      });
    else result.diagnostics.push(...file.diagnostics);
  }
  files = files.filter((file) => !file.error);
  const classes = files.flatMap((file) => file.classes);
  const assignments = files.flatMap((file) => file.assignments);
  const byName = new Map(classes.map((item) => [item.symbol, item]));
  const entries = new Map(
    context.entries
      .filter((entry) => entry.language === "ruby")
      .map((entry) => [entry.path, entry]),
  );
  const resolveName = (name: string | undefined, namespace: string[]): string | undefined => {
    if (!name) return undefined;
    if (name.startsWith("::")) return name.slice(2);
    for (let length = namespace.length; length >= 0; length--) {
      const candidate = [...namespace.slice(0, length), name].join("::");
      if (byName.has(candidate) || assignments.some((item) => item.symbol === candidate))
        return candidate;
    }
    return name;
  };
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
  for (const item of classes) {
    const entry = entries.get(item.path);
    if (!entry || entry.role === "worker") continue;
    const kind = nativeKind(item);
    if (!kind) {
      if (item.parent)
        result.diagnostics.push({
          code: "ruby.inheritance-unresolved",
          severity: "warning",
          source: { path: item.path, line: item.line },
          message: `${item.symbol}: superclass is not a statically resolved native Temporal definition. Preserve explicit native assembly.`,
        });
      continue;
    }
    const reopened = classes.filter((other) => other.symbol === item.symbol).length > 1;
    if (result.definitions.some((definition) => definition.id === `${entry.id}#${item.symbol}`))
      continue;
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
    result.definitions.push(definition);
  }
  for (const item of assignments) {
    const entry = entries.get(item.path);
    const call = invocation(item.value);
    if (!entry || entry.role === "worker" || !call || call.name !== "new") continue;
    const receiver = resolveName(call.receiver, item.namespace);
    if (receiver !== "Temporalio::Activity::Definition::Info") continue;
    const name = literal(keywords(call.args).name);
    const privateConstant = files.some((file) => file.private_constants.includes(item.symbol));
    result.definitions.push({
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
  for (const definition of result.definitions) {
    if (definition.identity.state === "unresolved" || definition.construction)
      result.diagnostics.push({
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
      result.diagnostics.push({
        code: "ruby.sdk-nexus-unavailable",
        severity: "warning",
        source: { path: entry.path },
        message:
          "Temporal Ruby SDK 1.11.0 has no Nexus service registration API (Worker sets enable_nexus: false). This is an SDK feature limit.",
      });
    if (
      entry.role !== "worker" &&
      !result.definitions.some((item) => item.entryId === entry.id) &&
      entry.role !== "nexus"
    )
      result.diagnostics.push({
        code: "ruby.no-static-definition",
        severity: "warning",
        source: { path: entry.path },
        message:
          "No native definition was resolved in this entry. Runtime factories, mixins and metaprogramming retain explicit native assembly.",
      });
  }
  const bundler = context.package.manifests.some((path) => posix.basename(path) === "Gemfile");
  const build = [
    ...(bundler ? [{ executable: "bundle", args: ["check"], cwd: context.package.root }] : []),
    ...files.map((file) => ({
      executable: "ruby",
      args: ["-c", "--", posix.relative(context.package.root, file.path)],
      cwd: context.package.root,
    })),
  ];
  for (const file of files) {
    const entry = entries.get(file.path);
    if (entry?.role !== "worker") continue;
    if (!file.runs.length) {
      if (
        files.some(
          (other) =>
            other.runs.length &&
            entries.get(other.path)?.workerName === entry.workerName &&
            entry.workerName,
        ) ||
        result.workers.some((worker) => worker.name === entry.workerName)
      )
        continue;
      result.diagnostics.push({
        code: "ruby.entrypoint-unresolved",
        severity: "warning",
        source: { path: file.path },
        message:
          "No top-level native Worker#run or Worker.run_all entrypoint was resolved. Use explicit native assembly and a Worker executable override.",
      });
      result.workers.push({
        id: `${context.package.id}:${file.path}`,
        name: entry.workerName ?? posix.basename(file.path, ".rb"),
        language: "ruby",
        packageId: context.package.id,
        source: { path: file.path },
        build,
        readiness: {
          state: "unavailable",
          description:
            "Native Worker entrypoint is unresolved. An executable override preserves native startup; readiness requires attributed native polling evidence.",
        },
      });
      continue;
    }
    const name = entry?.workerName ?? posix.basename(file.path, ".rb");
    const args = ["--", posix.relative(context.package.root, file.path)];
    const worker: WorkerProgram = {
      id: `${context.package.id}:${file.path}`,
      name,
      language: "ruby",
      packageId: context.package.id,
      source: { path: file.path, line: file.runs[0] },
      build,
      start: {
        executable: bundler ? "bundle" : "ruby",
        args: bundler ? ["exec", "ruby", ...args] : args,
        cwd: context.package.root,
      },
      readiness: {
        state: "unavailable",
        description:
          "Worker construction/run is not readiness. Require recent native Worker heartbeat attribution and successful polling for all known instances; dynamic instance coverage remains unknown.",
        evidence: [
          "native Worker heartbeat host/PID/start time",
          "instance-scoped successful poll timestamp",
          "native deployment drainage is separate from readiness",
        ],
      },
    };
    result.workers.push(worker);
  }
  // Collision scopes come only from literal arrays in authored Worker construction.
  for (const worker of files.filter((file) => owned(file.path)).flatMap((file) => file.workers)) {
    for (const [option, kind] of [
      ["workflows", "workflow"],
      ["activities", "activity"],
    ] as const) {
      const array = worker.options[option];
      if (!array) continue;
      if (array[0] !== "array") {
        result.diagnostics.push({
          code: "ruby.registration-scope-unresolved",
          severity: "info",
          source: { path: worker.path, line: worker.line },
          message: `Worker ${option} are computed; collision coverage is incomplete.`,
        });
        continue;
      }
      const seen = new Map<string, Definition>();
      let unresolved = false;
      for (const value of token(array[1])) {
        const ref = resolveName(constant(value) ?? invocation(value)?.receiver, worker.namespace);
        const definition = result.definitions.find(
          (item) => (item.symbol === ref || item.id.endsWith(`#${ref}`)) && item.kind === kind,
        );
        if (!definition || definition.identity.state === "unresolved") {
          unresolved = true;
          continue;
        }
        const key =
          definition.identity.state === "dynamic" ? "<dynamic>" : definition.identity.name!;
        const prior = seen.get(key);
        if (prior)
          result.diagnostics.push({
            code: "ruby.identity-collision",
            severity: "error",
            source: definition.source,
            related: [prior.source, { path: worker.path, line: worker.line }],
            message: `Native Worker ${kind} registrations repeat ${key}.`,
          });
        seen.set(key, definition);
      }
      if (unresolved)
        result.diagnostics.push({
          code: "ruby.registration-member-unresolved",
          severity: "info",
          source: { path: worker.path, line: worker.line },
          message: `Some native ${option} array members are unresolved; collision coverage is incomplete.`,
        });
    }
  }
  return result;
}

const rubyString = (value: string) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

async function emit(context: EmitContext): Promise<EmissionResult> {
  const result: EmissionResult = { artifacts: [], diagnostics: [] };
  const root = posix.join(context.package.root, ".gsys/ruby");
  const packageModule = `Package${createHash("sha256").update(context.package.id).digest("hex").slice(0, 16)}`;
  const requiredInputs = instanceInputs.get(context.analysis);
  if (!requiredInputs) throw new Error("Ruby emission requires its native analysis result.");
  const collections: { entry: SourceEntry; module: string; path: string; inputs: Definition[] }[] =
    [];
  for (const entry of context.entries.filter(
    (entry) => entry.language === "ruby" && entry.role !== "worker",
  )) {
    const definitions = context.analysis.definitions.filter((item) => item.entryId === entry.id);
    if (!definitions.length) continue;
    const hash = createHash("sha256").update(entry.path).digest("hex").slice(0, 16);
    const module = `Entry${hash}`;
    const path = posix.join(root, `${hash}.rb`);
    const eligible = definitions.filter((item) => !item.construction);
    const inputs = definitions.filter((item) => requiredInputs.has(item.id));
    const lines = [
      "# frozen_string_literal: true",
      "# Generated native Worker registration inputs. Do not edit.",
      `require_relative ${rubyString(posix.relative(root, entry.path))}`,
      "",
      "module GenesysGenerated",
      `  module ${packageModule}`,
      `  module ${module}`,
    ];
    lines.push(
      `    WORKFLOWS = [${eligible
        .filter((item) => item.kind === "workflow")
        .map((item) => `::${item.symbol}`)
        .join(", ")}].freeze`,
      ...inputs.map((item, index) => `    # instance_${index}: ::${item.symbol}`),
      `    def self.activities(${inputs.map((_, index) => `instance_${index}`).join(", ")})`,
      `      [${[...eligible.filter((item) => item.kind === "activity").map((item) => `::${item.symbol}`), ...inputs.map((_, index) => `instance_${index}`)].join(", ")}].freeze`,
      "    end",
      ...(inputs.length ? [] : ["    ACTIVITIES = activities"]),
      "  end",
      "  end",
      "end",
      "",
    );
    for (const definition of definitions.filter(
      (item) => item.construction && !requiredInputs.has(item.id),
    ))
      result.diagnostics.push({
        code: "ruby.registration-needs-assembly",
        severity: "warning",
        source: definition.source,
        message: `${definition.symbol} is not in generated arrays: ${definition.construction!.reason} Supply its existing native instance/Info through authored Worker options.`,
      });
    result.artifacts.push({ path, content: lines.join("\n"), kind: "registration" });
    collections.push({ entry, module, path, inputs });
  }
  const inputs = collections.flatMap((item) => item.inputs);
  const lines = [
    "# frozen_string_literal: true",
    "# Generated collections; application Worker code chooses its native registration scope.",
    ...collections.map((item) => `require_relative ${rubyString(posix.basename(item.path))}`),
    "",
    "module GenesysGenerated",
    `  module ${packageModule}`,
    `  WORKFLOWS = [${collections.map((item) => `*${item.module}::WORKFLOWS`).join(", ")}].freeze`,
    ...inputs.map((item, index) => `  # instance_${index}: ::${item.symbol}`),
    `  def self.activities(${inputs.map((_, index) => `instance_${index}`).join(", ")})`,
    `    [${collections.map((item) => `*${item.module}.activities(${item.inputs.map((input) => `instance_${inputs.indexOf(input)}`).join(", ")})`).join(", ")}].freeze`,
    "  end",
    ...(inputs.length ? [] : ["  ACTIVITIES = activities"]),
    "  end",
    "end",
    "",
  ];
  result.artifacts.push({
    path: posix.join(root, "registration.rb"),
    content: lines.join("\n"),
    kind: "registration",
  });
  result.artifacts.push({
    path: posix.join(root, "manifest.json"),
    content: `${JSON.stringify({ inspectedSdk: "temporalio 1.11.0", module: `GenesysGenerated::${packageModule}`, activities: { method: "activities", instances: inputs.map((item, index) => ({ parameter: `instance_${index}`, type: item.symbol })) }, collections: collections.map((item) => ({ source: item.entry.path, path: item.path, module: `GenesysGenerated::${packageModule}::${item.module}`, instances: item.inputs.map((input, index) => ({ parameter: `instance_${index}`, type: input.symbol })) })) }, null, 2)}\n`,
    kind: "metadata",
  });
  return result;
}

export const rubyAdapter: NativeAdapter = { language: "ruby", analyze, emit };
