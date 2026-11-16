import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AnalysisContext,
  AnalysisResult,
  Diagnostic,
  EmissionResult,
  NativeAdapter,
} from "../contracts.js";

type RustDefinition = {
  path: string;
  line: number;
  kind: "workflow" | "activity";
  symbol: string;
  name: string | null;
  target: string;
  module: string;
  implementer: string;
  factory: boolean;
  eligible: boolean;
};
type RustAnalysis = {
  definitions: RustDefinition[];
  diagnostics: { code: string; severity: Diagnostic["severity"]; path: string; message: string }[];
  targets: { name: string; path: string; kind: "lib" | "bin"; requiredFeatures: string[] }[];
  sdk: string | null;
};
const nativeEvidence =
  "Native Worker heartbeat attributed to the owned process and fresh successful poll evidence are required. Worker::run and process startup do not prove readiness. Unknown Worker coverage prevents program-wide readiness or retirement.";

function run(executable: string, args: string[], cwd: string, input?: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env };
    // Application Cargo wrappers and flags must not participate in static analysis.
    for (const name of [
      "RUSTC_WRAPPER",
      "RUSTC_WORKSPACE_WRAPPER",
      "RUSTFLAGS",
      "CARGO_ENCODED_RUSTFLAGS",
      "CARGO_BUILD_RUSTC_WRAPPER",
      "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
      "RUSTC",
      "CARGO_BUILD_RUSTC",
      "CARGO_TARGET_DIR",
    ])
      delete env[name];
    const child = execFile(
      executable,
      args,
      { cwd, env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`${executable} failed: ${stderr.trim() || error.message}`));
        else resolveResult(stdout);
      },
    );
    child.stdin?.on("error", () => {
      /* execFile reports process errors. */
    });
    child.stdin?.end(input);
  });
}

async function inspect(context: AnalysisContext): Promise<RustAnalysis> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../sdk/rust/analyzer");
  await access(join(source, "Cargo.lock"));
  const directory = await mkdtemp(join(tmpdir(), "genesys-rust-analyzer-"));
  try {
    await mkdir(join(directory, "src"));
    for (const path of ["Cargo.toml", "Cargo.lock", "src/main.rs"])
      await writeFile(join(directory, path), await readFile(join(source, path)));
    await run(
      "cargo",
      ["build", "--locked", "--manifest-path", join(directory, "Cargo.toml")],
      directory,
    );
    const executable = join(
      directory,
      "target",
      "debug",
      `genesys-rust-analyzer${process.platform === "win32" ? ".exe" : ""}`,
    );
    const input = JSON.stringify({
      root: context.package.root,
      sources: Object.fromEntries(context.sources),
      entries: Object.fromEntries(context.entries.map((entry) => [entry.path, entry.role])),
    });
    return JSON.parse(await run(executable, [], directory, input)) as RustAnalysis;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function diagnostic(error: unknown): Diagnostic {
  return {
    code: "rust.analysis-unavailable",
    severity: "error",
    message: `Rust static analysis failed: ${error instanceof Error ? error.message : String(error)}. Authored native assembly remains available; no definitions were guessed.`,
  };
}
function artifactRoot(context: AnalysisContext): string {
  return `.gsys/compile/rust/${slug(context.package.id)}`;
}
function groupKey(d: RustDefinition): string {
  return `${d.target}/${d.module}`;
}
function slug(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

const analyses = new WeakMap<AnalysisResult, RustAnalysis>();

export const rustAdapter: NativeAdapter = {
  language: "rust",
  async analyze(context): Promise<AnalysisResult> {
    let parsed: RustAnalysis;
    try {
      parsed = await inspect(context);
    } catch (error) {
      return { definitions: [], workers: [], diagnostics: [diagnostic(error)] };
    }
    const diagnostics: Diagnostic[] = parsed.diagnostics.map(({ path, ...rest }) => ({
      ...rest,
      source: { path },
    }));
    diagnostics.push({
      code: "rust.sdk-api",
      severity: "info",
      source: { path: context.package.manifests[0] ?? context.package.root },
      message: `Registration targets released temporalio-sdk/macros 1.2.0. Manifest SDK requirement: ${parsed.sdk ?? "unresolved"}. Cargo validates the application's actual dependency resolution. No authored code or build.rs ran during analysis.`,
    });
    const definitions = parsed.definitions.map((definition) => ({
      id: `${context.package.id}:${definition.target}:${definition.symbol}:${definition.path}:${definition.line}`,
      source: { path: definition.path, line: definition.line },
      entryId: context.entries.find((entry) => entry.path === definition.path)!.id,
      language: "rust" as const,
      kind: definition.kind,
      symbol: definition.symbol,
      identity:
        definition.name === null
          ? {
              state: "unresolved" as const,
              reason:
                "Native name expression requires compiler evaluation or an external ActivityDefinition.",
            }
          : { state: "resolved" as const, name: definition.name },
      ...(definition.kind === "activity" || definition.factory
        ? {
            construction: {
              symbol: definition.implementer,
              reason: definition.factory
                ? "Application supplies the native Workflow factory."
                : "Application supplies one native Activity implementer instance for all its methods.",
            },
          }
        : {}),
    }));
    for (const group of new Set(parsed.definitions.map(groupKey))) {
      const names = new Map<string, RustDefinition>();
      for (const definition of parsed.definitions.filter(
        (d) => groupKey(d) === group && d.eligible && d.name !== null,
      )) {
        const key = `${definition.kind}:${definition.name}`;
        const previous = names.get(key);
        if (previous)
          diagnostics.push({
            code: "rust.generated-scope-collision",
            severity: "warning",
            source: { path: definition.path, line: definition.line },
            related: [{ path: previous.path, line: previous.line }],
            message: `Native ${definition.kind} name ${JSON.stringify(definition.name)} collides in this generated module registration. Explicit native assembly can select separate scopes.`,
          });
        names.set(key, definition);
      }
    }
    const cwd = resolve(context.projectRoot, context.package.root);
    const output = resolve(context.projectRoot, artifactRoot(context), "target");
    const workers = parsed.targets
      .filter((target) => target.kind === "bin")
      .map((target) => ({
        id: `${context.package.id}:bin:${target.name}`,
        name: target.name,
        language: "rust" as const,
        packageId: context.package.id,
        source: { path: target.path },
        build: [
          {
            executable: "cargo",
            args: [
              "build",
              "--manifest-path",
              "Cargo.toml",
              "--bin",
              target.name,
              "--target-dir",
              output,
              ...(target.requiredFeatures.length
                ? ["--features", target.requiredFeatures.join(",")]
                : []),
            ],
            cwd,
          },
        ],
        start: {
          executable: "cargo",
          args: [
            "run",
            "--quiet",
            "--manifest-path",
            "Cargo.toml",
            "--bin",
            target.name,
            "--target-dir",
            output,
            ...(target.requiredFeatures.length
              ? ["--features", target.requiredFeatures.join(",")]
              : []),
            "--",
          ],
          cwd,
        },
        readiness: {
          state: "unavailable" as const,
          description: nativeEvidence,
          evidence: ["native-worker-heartbeat", "native-successful-task-poll"],
        },
      }));
    const result = { definitions, diagnostics, workers };
    analyses.set(result, parsed);
    return result;
  },
  async emit(context): Promise<EmissionResult> {
    const parsed = analyses.get(context.analysis);
    if (!parsed)
      throw new Error("Rust emission requires the native analysis result from this process.");
    const artifacts: EmissionResult["artifacts"] = [];
    const diagnostics: Diagnostic[] = [];
    const scopes: {
      target: string;
      module: string;
      artifact: string;
      include: string;
      function: string;
      inputs: string[];
    }[] = [];
    for (const key of new Set(parsed.definitions.map(groupKey))) {
      const all = parsed.definitions.filter((d) => groupKey(d) === key);
      const definitions = all.filter(
        (d) =>
          d.eligible &&
          !all.some((other) => other.implementer === d.implementer && !other.eligible),
      );
      if (!definitions.length) continue;
      const names = definitions.filter((d) => d.name !== null).map((d) => `${d.kind}:${d.name}`);
      if (new Set(names).size !== names.length) continue;
      const index = slug(key);
      const functionName = `genesys_register_${index}`;
      const inputs: string[] = [];
      const params: string[] = [];
      const bounds: string[] = [];
      const statements: string[] = [];
      const seen = new Set<string>();
      for (const definition of definitions) {
        const type = definition.implementer;
        const identity = `${definition.kind}:${type}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (definition.kind === "activity") {
          const parameter = `activities_${params.length}`;
          params.push(`${parameter}: ${type}`);
          inputs.push(`${parameter}: ${type}`);
          statements.push(`    options = options.register_activities(${parameter});`);
        } else if (definition.factory) {
          const parameter = `factory_${params.length}`;
          params.push(`${parameter}: impl Fn() -> ${type} + Send + Sync + 'static`);
          inputs.push(`${parameter}: native factory for ${type}`);
          statements.push(
            `    options = options.register_workflow_with_factory::<${type}, _>(${parameter})?;`,
          );
        } else statements.push(`    options = options.register_workflow::<${type}>()?;`);
      }
      bounds.push("S: temporalio_sdk::worker_options_builder::State");
      const content = `// Code generated by Genesys. Include inside the native module recorded in scopes.json.\n// Application instances retain their native ownership; no constructors are generated.\nfn ${functionName}<S>(\n    mut options: temporalio_sdk::WorkerOptionsBuilder<S>,\n${params.map((p) => `    ${p},\n`).join("")}) -> Result<temporalio_sdk::WorkerOptionsBuilder<S>, temporalio_sdk::WorkflowRegistrationError>\nwhere\n    ${bounds.join(",\n    ")},\n{\n${statements.join("\n")}\n    Ok(options)\n}\n`;
      const path = `${artifactRoot(context)}/registration/${index}.rs`;
      artifacts.push({ path, content, kind: "registration" });
      const first = definitions[0]!;
      scopes.push({
        target: first.target,
        module: first.module || "crate",
        artifact: path,
        include: `include!(concat!(env!("CARGO_MANIFEST_DIR"), ${JSON.stringify(`/${relative(resolve(context.projectRoot, context.package.root), resolve(context.projectRoot, path)).split("\\").join("/")}`)}));`,
        function: functionName,
        inputs,
      });
    }
    artifacts.push({
      path: `${artifactRoot(context)}/scopes.json`,
      content: `${JSON.stringify({ generatedBy: "Genesys", sdkApi: "temporalio-sdk 1.2.0", scopes }, null, 2)}\n`,
      kind: "metadata",
    });
    diagnostics.push({
      code: "rust.registration-scope",
      severity: "info",
      message:
        "Include each generated registration fragment in its recorded native module, then call the generated function with the existing WorkerOptionsBuilder and application-owned instances/factories. The module scope preserves private types and native handlers. No registration is injected into authored programs.",
    });
    return { artifacts, diagnostics };
  },
};
