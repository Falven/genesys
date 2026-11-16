import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  AnalysisContext,
  AnalysisResult,
  Definition,
  Diagnostic,
  EmissionResult,
  NativeAdapter,
  SourceEntry,
  WorkerProgram,
} from "../contracts.js";

const execute = promisify(execFile);
const assets = fileURLToPath(new URL("../../sdk/java/", import.meta.url));
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
interface Expression {
  literal?: string;
  reference?: string;
  className?: string;
  concat?: Expression[];
}
interface Annotation {
  name: string;
  values: Record<string, Expression>;
}
interface Method {
  name: string;
  flags: string[];
  annotations: Annotation[];
  parameters: string[];
  returns: string;
  throwsTypes: string[];
}
interface JavaType {
  name: string;
  simple: string;
  packageName: string;
  path: string;
  line: number;
  flags: string[];
  accessible: boolean;
  nested: boolean;
  kind: string;
  parents: string[];
  generic: boolean;
  annotations: Annotation[];
  imports: string[];
  staticImports: string[];
  methods: Method[];
  constants: Record<string, Expression>;
}
interface Parsed {
  maven?: {
    properties: Record<string, string>;
    outputDirectory: string;
    parent: boolean;
    profiles: boolean;
    packaging: string;
  };
  types: JavaType[];
  diagnostics: { message: string; path: string; line: number; error: boolean }[];
}
interface Registration {
  type: JavaType;
  kind: Definition["kind"];
  entry: SourceEntry;
}
const models = new WeakMap<AnalysisResult, Registration[]>();

const location = (type: JavaType) => ({ path: type.path, line: type.line });
const inside = (path: string, root: string) => root === "." || path.startsWith(`${root}/`);
const javaExecutable = () =>
  process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";

function packageSources(context: AnalysisContext): [string, string][] {
  const nestedPackages = [...context.sources.keys()]
    .filter(
      (path) =>
        inside(path, context.package.root) &&
        ["pom.xml", "build.gradle", "build.gradle.kts"].includes(posix.basename(path)) &&
        posix.dirname(path) !== context.package.root,
    )
    .map(posix.dirname);
  return [...context.sources].filter(
    ([path]) =>
      path.endsWith(".java") &&
      inside(path, context.package.root) &&
      !nestedPackages.some((root) => inside(path, root)),
  );
}

async function parse(context: AnalysisContext): Promise<Parsed> {
  const scratch = await mkdtemp(join(tmpdir(), "genesys-java-"));
  try {
    const paths: string[] = [];
    for (const [path, content] of packageSources(context)) {
      const output = join(scratch, path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content);
      paths.push(output);
    }
    if (!paths.length) return { types: [], diagnostics: [] };
    const input = join(scratch, "sources.txt");
    await writeFile(input, paths.sort().join("\n"));
    const pom = context.package.manifests.find((path) => path.endsWith("pom.xml"));
    if (pom) await writeFile(join(scratch, "pom.xml"), context.sources.get(pom)!);
    const { stdout } = await execute(
      javaExecutable(),
      [join(assets, "Inspect.java"), input, ...(pom ? [join(scratch, "pom.xml")] : [])],
      {
        cwd: scratch,
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const parsed = JSON.parse(stdout) as Parsed;
    for (const type of parsed.types) type.path = relative(scratch, type.path).split("\\").join("/");
    for (const diagnostic of parsed.diagnostics)
      if (diagnostic.path)
        diagnostic.path = relative(scratch, diagnostic.path).split("\\").join("/");
    return parsed;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function resolver(types: JavaType[]) {
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

async function launcher(context: AnalysisContext): Promise<string> {
  const maven = context.package.manifests.some((path) => path.endsWith("pom.xml"));
  const wrapper = maven
    ? process.platform === "win32"
      ? "mvnw.cmd"
      : "mvnw"
    : process.platform === "win32"
      ? "gradlew.bat"
      : "gradlew";
  for (let directory = context.package.root; ; directory = posix.dirname(directory)) {
    try {
      await access(join(context.projectRoot, directory, wrapper));
      const path = posix.relative(context.package.root, posix.join(directory, wrapper));
      return path.startsWith(".") ? path : `./${path}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (directory === ".") break;
  }
  return maven ? "mvn" : "gradle";
}

async function analyze(context: AnalysisContext): Promise<AnalysisResult> {
  const result: AnalysisResult = { definitions: [], diagnostics: [], workers: [] };
  const registrations: Registration[] = [];
  models.set(result, registrations);
  const add = (
    code: string,
    message: string,
    type?: JavaType,
    severity: Diagnostic["severity"] = "warning",
  ) =>
    result.diagnostics.push({
      code: `java.${code}`,
      severity,
      message,
      ...(type ? { source: location(type) } : {}),
    });
  for (const entry of context.entries.filter((entry) => entry.path.endsWith(".kt")))
    result.diagnostics.push({
      code: "java.kotlin-analysis-unavailable",
      severity: "warning",
      source: { path: entry.path },
      message:
        "Kotlin is supported by the Java SDK. This Java compiler reader cannot analyze Kotlin; retain explicit native assembly.",
    });
  let parsed: Parsed;
  try {
    parsed = await parse(context);
  } catch (error) {
    add(
      "parser-unavailable",
      `Java analysis requires a JDK 17+ available through JAVA_HOME or PATH. No application code was executed. ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      "error",
    );
    return result;
  }
  for (const diagnostic of parsed.diagnostics)
    result.diagnostics.push({
      code: "java.syntax",
      severity: diagnostic.error ? "error" : "warning",
      source: { path: diagnostic.path, line: diagnostic.line },
      message: diagnostic.message,
    });
  const { index, qualify, annotation, value } = resolver(parsed.types);
  const entries = new Map(context.entries.map((entry) => [entry.path, entry]));
  const buildTool = await launcher(context);
  const maven = context.package.manifests.some((path) => path.endsWith("pom.xml"));
  const gradleScript = ".gsys/java/worker.gradle";
  const modulePath = packageSources(context).some(
    ([path]) => posix.basename(path) === "module-info.java",
  );
  function mavenValue(input: string, seen = new Set<string>()): string | undefined {
    let unresolved = false;
    const output = input.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      if (seen.has(key) || !parsed.maven?.properties[key]) {
        unresolved = true;
        return "";
      }
      const resolved = mavenValue(parsed.maven.properties[key], new Set([...seen, key]));
      if (resolved === undefined) unresolved = true;
      return resolved ?? "";
    });
    return unresolved ? undefined : output;
  }
  const outputDirectory = parsed.maven ? mavenValue(parsed.maven.outputDirectory) : undefined;
  const mavenLaunch =
    !!outputDirectory &&
    !posix.isAbsolute(outputDirectory) &&
    !outputDirectory.split("/").includes("..") &&
    !outputDirectory.includes("\\") &&
    parsed.maven?.packaging === "jar" &&
    !parsed.maven.parent &&
    !parsed.maven.profiles;
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
  for (const type of parsed.types) {
    const entry = entries.get(type.path);
    if (!entry) continue;
    if (entry.role === "worker") {
      for (const method of type.methods)
        if (
          method.name === "main" &&
          method.flags.includes("public") &&
          method.flags.includes("static") &&
          method.returns === "void" &&
          method.parameters.length === 1 &&
          ["String[]", "java.lang.String[]"].includes(method.parameters[0]!)
        ) {
          const worker: WorkerProgram = {
            id: `${context.package.id}:${type.name}`,
            name: entry.workerName ?? type.simple,
            language: "java",
            packageId: context.package.id,
            source: location(type),
            workingDirectory: context.package.root,
            build: [
              {
                executable: buildTool,
                cwd: context.package.root,
                args: maven
                  ? [
                      "-B",
                      "-DskipTests",
                      "compile",
                      "org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy-dependencies",
                      "-DincludeScope=runtime",
                      "-DoutputDirectory=target/genesys-dependencies",
                    ]
                  : ["--init-script", gradleScript, "gsysPrepareWorker", "-x", "test"],
              },
            ],
            start: {
              executable: javaExecutable(),
              cwd: context.package.root,
              args: [
                "-cp",
                maven
                  ? [outputDirectory ?? "target/classes", "target/genesys-dependencies/*"].join(
                      delimiter,
                    )
                  : ["build/genesys-worker", "build/genesys-worker/*"].join(delimiter),
                type.name.replace(type.packageName ? `${type.packageName}.` : "", "").includes(".")
                  ? `${type.packageName ? `${type.packageName}.` : ""}${type.name.slice(type.packageName ? type.packageName.length + 1 : 0).replaceAll(".", "$")}`
                  : type.name,
              ],
            },
            readiness: {
              state: "unavailable",
              description:
                "WorkerFactory.start/isStarted and process startup do not prove polling. Observe native Worker heartbeats matched to process generation and successful polls; arbitrary Worker creation leaves whole-program coverage unknown.",
              evidence: [
                "Worker heartbeat (Java SDK 1.35+, enabled; compatible server)",
                "Attributed native successful poll timestamps",
              ],
            },
          };
          if (maven && !mavenLaunch) {
            delete worker.start;
            add(
              "maven-launch-unresolved",
              "Maven parent/profile models, non-JAR modules, and unresolved or external output directories require native executable assembly. Static inspection does not execute Maven to obtain an effective model.",
              type,
            );
          }
          if (modulePath) {
            delete worker.start;
            add(
              "module-launch-unresolved",
              "Java modules require native module-path and launcher assembly; a classpath launch would bypass the authored module model.",
              type,
            );
          }
          result.workers.push(worker);
        }
      continue;
    }
    if (["INTERFACE", "ANNOTATION_TYPE"].includes(type.kind) || type.flags.includes("abstract"))
      continue;
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
          const marker = annotation(
            method.annotations,
            "io.temporal.workflow.WorkflowMethod",
            owner,
          );
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
          const marker = annotation(
            method.annotations,
            "io.temporal.activity.ActivityMethod",
            owner,
          );
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
  }
  const workerDirectory = (path: string): string => {
    const directory = entries.get(path)?.workerDirectory;
    if (!directory) throw new Error(`Missing native Worker directory for ${path}.`);
    return directory;
  };
  const workerGroups = new Map<string, WorkerProgram[]>();
  for (const worker of result.workers) {
    const directory = workerDirectory(worker.source.path);
    workerGroups.set(directory, [...(workerGroups.get(directory) ?? []), worker]);
  }
  result.workers = [...workerGroups].map(([directory, candidates]) => {
    const first = candidates[0]!;
    if (candidates.length === 1) return first;
    result.diagnostics.push({
      code: "java.entrypoint-ambiguous",
      severity: "warning",
      source: first.source,
      related: candidates.slice(1).map((candidate) => candidate.source),
      message: `Several native main classes belong to Worker ${first.name}; supply an executable override. Candidates: ${candidates.map((candidate) => candidate.id).join(", ")}.`,
    });
    const { start: _start, ...unresolved } = first;
    return { ...unresolved, id: `${context.package.id}:worker:${directory}` };
  });
  for (const entry of context.entries.filter(
    (entry) => entry.role === "worker" && entry.path.endsWith(".java"),
  )) {
    if (
      !entry.workerName ||
      result.workers.some(
        (worker) => workerDirectory(worker.source.path) === workerDirectory(entry.path),
      )
    )
      continue;
    result.diagnostics.push({
      code: "java.entrypoint-unresolved",
      severity: "warning",
      source: { path: entry.path },
      message:
        "No public static void main(String[]) entrypoint was found. Supply a native executable override for this named Worker.",
    });
    result.workers.push({
      id: `${context.package.id}:worker:${workerDirectory(entry.path)}`,
      name: entry.workerName,
      language: "java",
      packageId: context.package.id,
      source: { path: entry.path },
      workingDirectory: context.package.root,
      build: [
        {
          executable: buildTool,
          cwd: context.package.root,
          args: maven ? ["-B", "-DskipTests", "compile"] : ["classes", "-x", "test"],
        },
      ],
      readiness: {
        state: "unavailable",
        description:
          "Native executable override required; complete Worker coverage remains unknown.",
      },
    });
  }
  for (const worker of result.workers) {
    if (result.workers.some((other) => other.id !== worker.id && other.name === worker.name))
      result.diagnostics.push({
        code: "java.entrypoint-ambiguous",
        severity: "error",
        source: worker.source,
        message: `Distinct native Worker directories share name ${worker.name}. Use unique directory names so Worker selection is unambiguous.`,
      });
  }
  if (result.workers.length && maven)
    add(
      "maven-layout",
      "Maven launch uses the resolved outputDirectory and copied runtime dependencies. Module-path applications and reactor-only dependencies require native executable assembly.",
      undefined,
      "info",
    );
  return result;
}

function defaultConstructor(type: JavaType): boolean {
  if (!type.accessible || (type.nested && !type.flags.includes("static")) || type.kind !== "CLASS")
    return false;
  const constructors = type.methods.filter((method) => method.name === "<init>");
  return (
    !constructors.length ||
    constructors.some(
      (method) =>
        !method.parameters.length && method.flags.includes("public") && !method.throwsTypes.length,
    )
  );
}

const gradle = `// Generated native Gradle build integration. Evaluated only during an authorized build.
gradle.projectsEvaluated {
  def directory = gradle.startParameter.currentDir.canonicalFile
  def application = gradle.rootProject.allprojects.find { it.projectDir.canonicalFile == directory }
  if (application == null) throw new GradleException('Genesys cannot resolve the native Gradle project for the package directory')
  def sources = application.extensions.findByName('sourceSets')
  if (sources == null || sources.findByName('main') == null) {
    throw new GradleException('Genesys requires a Java main source set; use native assembly for other layouts')
  }
  application.tasks.register('gsysPrepareWorker', Sync) {
    dependsOn application.tasks.named('classes')
    from sources.main.runtimeClasspath
    into application.file('build/genesys-worker')
    duplicatesStrategy = DuplicatesStrategy.FAIL
  }
}
`;

export const javaAdapter: NativeAdapter = {
  language: "java",
  analyze,
  async emit(context): Promise<EmissionResult> {
    const reused = models.has(context.analysis);
    const analysis = reused ? context.analysis : await analyze(context);
    const registrations = models.get(analysis) ?? [];
    const result: EmissionResult = {
      artifacts: [],
      diagnostics: reused ? [] : [...analysis.diagnostics],
    };
    const groups = new Map<string, Registration[]>();
    for (const registration of registrations) {
      const group = groups.get(registration.entry.discoveryRoot) ?? [];
      group.push(registration);
      groups.set(registration.entry.discoveryRoot, group);
    }
    for (const [root, group] of groups) {
      const className = `GenesysRegistration_${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
      const parameters: string[] = [];
      const calls: string[] = [];
      for (const { type, kind } of group.sort((a, b) => a.type.name.localeCompare(b.type.name))) {
        if (
          !type.accessible ||
          !type.packageName ||
          (type.nested && !type.flags.includes("static"))
        ) {
          result.diagnostics.push({
            code: "java.registration-visibility",
            severity: "warning",
            source: location(type),
            message: `${type.name} cannot be referenced by the generated aggregate. Preserve its native assembly in the authored scope.`,
          });
          continue;
        }
        if (kind === "workflow") {
          const { annotation } = resolver([type]);
          if (
            !defaultConstructor(type) &&
            !type.methods.some(
              (method) =>
                method.name === "<init>" &&
                method.flags.includes("public") &&
                annotation(method.annotations, "io.temporal.workflow.WorkflowInit", type),
            )
          ) {
            result.diagnostics.push({
              code: "java.workflow-construction",
              severity: "warning",
              source: location(type),
              message: `${type.name} has no resolved public no-argument or @WorkflowInit constructor. Preserve explicit native assembly; Genesys does not invent arguments or use testing-only Workflow factories.`,
            });
            continue;
          }
          calls.push(`    worker.registerWorkflowImplementationTypes(${type.name}.class);`);
        } else {
          const argument = `instance${parameters.length}`;
          parameters.push(`${type.name} ${argument}`);
          calls.push(
            `    worker.${kind === "activity" ? "registerActivitiesImplementations" : "registerNexusServiceImplementation"}(${argument});`,
          );
        }
      }
      const content = `// Generated by Genesys. Native Worker code chooses where to call this aggregate.\npackage genesys.generated;\n\npublic final class ${className} {\n  private ${className}() {}\n  public static void register(io.temporal.worker.Worker worker${parameters.map((parameter) => `, ${parameter}`).join("")}) {\n${calls.join("\n")}\n  }\n}\n`;
      const sourceRoots = new Set(
        group.map(({ type }) => {
          const directory = posix.dirname(type.path);
          const suffix = type.packageName.replaceAll(".", "/");
          return suffix && directory.endsWith(`/${suffix}`)
            ? directory.slice(0, -suffix.length - 1)
            : undefined;
        }),
      );
      if (sourceRoots.size !== 1 || sourceRoots.has(undefined)) {
        result.diagnostics.push({
          code: "java.source-layout-unresolved",
          severity: "warning",
          source: { path: root },
          message:
            "Generated registration is inspectable under .gsys/generated/java. Multiple or nonstandard source roots require native source-set inclusion.",
        });
      }
      const sourceRoot =
        sourceRoots.size === 1 && !sourceRoots.has(undefined)
          ? [...sourceRoots][0]!
          : posix.join(context.package.root, ".gsys/generated/java");
      let collision = false;
      const names = new Map<string, Definition>();
      for (const definition of analysis.definitions.filter((item) =>
        group.some((registration) => registration.type.name === item.construction?.symbol),
      )) {
        if (definition.identity.state === "unresolved") continue;
        const key = `${definition.kind}:${definition.identity.state === "dynamic" ? "<dynamic>" : definition.identity.name}`;
        const previous = names.get(key);
        if (previous) {
          collision = true;
          result.diagnostics.push({
            code: "java.aggregate-collision",
            severity: "warning",
            source: definition.source,
            related: [previous.source],
            message: `${key} collides inside ${className}.register; the ambiguous aggregate is omitted. Separate native Workers can reuse names; preserve native assembly for those scopes.`,
          });
        }
        names.set(key, definition);
      }
      if (!collision) {
        result.artifacts.push({
          path: posix.join(sourceRoot, "genesys/generated", `${className}.java`),
          content,
          kind: "registration",
        });
      }
    }
    if (
      analysis.workers.length &&
      !context.package.manifests.some((path) => path.endsWith("pom.xml"))
    )
      result.artifacts.push({
        path: posix.join(context.package.root, ".gsys/java/worker.gradle"),
        content: gradle,
        kind: "source",
      });
    return result;
  },
};
