import { resolve } from "node:path";
import type { AnalysisContext, AnalysisResult, Diagnostic } from "../../contracts.js";
import { registrationCollisions } from "../registration.js";
import type { RustAnalysis } from "./model.js";
import { artifactRoot, groupKey } from "./registration.js";

const nativeEvidence =
  "Native Worker heartbeat attributed to the owned process and fresh successful poll evidence are required. Worker::run and process startup do not prove readiness. Unknown Worker coverage prevents program-wide readiness or retirement.";

export function planAnalysis(context: AnalysisContext, parsed: RustAnalysis): AnalysisResult {
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
    const members = parsed.definitions.filter(
      (definition) =>
        groupKey(definition) === group && definition.eligible && definition.name !== null,
    );
    for (const { definition, previous } of registrationCollisions(
      members,
      (definition) => `${definition.kind}:${definition.name}`,
    )) {
      diagnostics.push({
        code: "rust.generated-scope-collision",
        severity: "warning",
        source: { path: definition.path, line: definition.line },
        related: [{ path: previous.path, line: previous.line }],
        message: `Native ${definition.kind} name ${JSON.stringify(definition.name)} collides in this generated module registration. Explicit native assembly can select separate scopes.`,
      });
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
  return { definitions, diagnostics, workers };
}
