import { join, posix } from "node:path";
import type {
  AnalysisContext,
  Definition,
  Diagnostic,
  NativeOutput,
  WorkerProgram,
} from "../../contracts.js";
import { runTool } from "../tooling.js";
import { constant, invocation, token, type ParsedFile } from "./source.js";

export async function workerPrograms({
  context,
  files,
  definitions,
  resolveName,
  ownsSource,
}: {
  context: AnalysisContext;
  files: ParsedFile[];
  definitions: Definition[];
  resolveName: (name: string | undefined, namespace: string[]) => string | undefined;
  ownsSource: (path: string) => boolean;
}) {
  const workers: WorkerProgram[] = [];
  const diagnostics: Diagnostic[] = [];
  const entries = new Map(
    context.entries
      .filter((entry) => entry.language === "ruby")
      .map((entry) => [entry.path, entry]),
  );
  const { root, manifests } = context.package;
  const gemfile = manifests.find((path) => posix.basename(path) === "Gemfile");
  const production = context.mode === "production";
  const bundlePath =
    production && gemfile && files.some((file) => entries.get(file.path)?.role === "worker")
      ? await defaultBundlePath(join(context.projectRoot, root))
      : undefined;
  const bundleDefaults = bundlePath ? { env: { BUNDLE_PATH: bundlePath } } : {};
  const registration = ".gsys/ruby/registration.rb";
  const build = [
    ...(gemfile
      ? [
          {
            executable: "bundle",
            args: [production ? "install" : "check"],
            cwd: root,
            ...bundleDefaults,
          },
        ]
      : []),
    ...(production ? [{ executable: "ruby", args: ["-c", "--", registration], cwd: root }] : []),
    ...files.map((file) => ({
      executable: "ruby",
      args: ["-c", "--", posix.relative(root, file.path)],
      cwd: root,
    })),
  ];
  const lockfile = posix.join(root, "Gemfile.lock");
  const dependencies = manifests.map((path) => ({
    path,
    kind: path === gemfile ? "bundler-manifest" : "ruby-gemspec",
  }));
  if (gemfile && context.sources.has(lockfile))
    dependencies.push({ path: lockfile, kind: "bundler-lockfile" });
  for (const file of files) {
    const entry = entries.get(file.path);
    if (entry?.role !== "worker") continue;
    const nativeOutput: NativeOutput = {
      paths: [
        file.path,
        posix.join(root, registration),
        ...(bundlePath ? [posix.join(root, bundlePath)] : []),
      ],
      target: { runtime: "Ruby" },
      dependencies,
      runtimeRequirements: [
        "Ruby version and platform compatible with the application and native gems",
        ...(gemfile ? ["Bundler and access to any external gem paths selected by Bundler"] : []),
        "System libraries required by native gems",
      ],
    };
    if (!file.runs.length) {
      if (
        files.some(
          (other) =>
            other.runs.length &&
            entries.get(other.path)?.workerName === entry.workerName &&
            entry.workerName,
        ) ||
        workers.some((worker) => worker.name === entry.workerName)
      )
        continue;
      diagnostics.push({
        code: "ruby.entrypoint-unresolved",
        severity: "warning",
        source: { path: file.path },
        message:
          "No top-level native Worker#run or Worker.run_all entrypoint was resolved. Use explicit native assembly and a Worker executable override.",
      });
      workers.push({
        id: `${context.package.id}:${file.path}`,
        name: entry.workerName ?? posix.basename(file.path, ".rb"),
        language: "ruby",
        packageId: context.package.id,
        source: { path: file.path },
        build,
        ...(production ? { nativeOutput } : {}),
        readiness: {
          state: "unavailable",
          description:
            "Native Worker entrypoint is unresolved. An executable override preserves native startup; readiness requires attributed native polling evidence.",
        },
      });
      continue;
    }
    const name = entry?.workerName ?? posix.basename(file.path, ".rb");
    const args = ["--", posix.relative(root, file.path)];
    const worker: WorkerProgram = {
      id: `${context.package.id}:${file.path}`,
      name,
      language: "ruby",
      packageId: context.package.id,
      source: { path: file.path, line: file.runs[0] },
      build,
      ...(production ? { nativeOutput } : {}),
      start: {
        executable: gemfile ? "bundle" : "ruby",
        args: gemfile ? ["exec", "ruby", ...args] : args,
        cwd: root,
        ...bundleDefaults,
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
    workers.push(worker);
  }
  diagnostics.push(...registrationDiagnostics(files, definitions, resolveName, ownsSource));
  return { workers, diagnostics };
}

async function defaultBundlePath(cwd: string): Promise<string | undefined> {
  const settings = await runTool({
    executable: "ruby",
    args: ["-S", "bundle", "config", "list", "--parseable"],
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  // Keep Bundler's path selection when the application configures it at any scope.
  return /^(?:(?:path|path\.system|disable_shared_gems)=|deployment=true\r?$)/m.test(settings)
    ? undefined
    : "vendor/bundle";
}

function registrationDiagnostics(
  files: ParsedFile[],
  definitions: Definition[],
  resolveName: (name: string | undefined, namespace: string[]) => string | undefined,
  ownsSource: (path: string) => boolean,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const worker of files
    .filter((file) => ownsSource(file.path))
    .flatMap((file) => file.workers)) {
    for (const [option, kind] of [
      ["workflows", "workflow"],
      ["activities", "activity"],
    ] as const) {
      const array = worker.options[option];
      if (!array) continue;
      if (array[0] !== "array") {
        diagnostics.push({
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
        const definition = definitions.find(
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
          diagnostics.push({
            code: "ruby.identity-collision",
            severity: "error",
            source: definition.source,
            related: [prior.source, { path: worker.path, line: worker.line }],
            message: `Native Worker ${kind} registrations repeat ${key}.`,
          });
        seen.set(key, definition);
      }
      if (unresolved)
        diagnostics.push({
          code: "ruby.registration-member-unresolved",
          severity: "info",
          source: { path: worker.path, line: worker.line },
          message: `Some native ${option} array members are unresolved; collision coverage is incomplete.`,
        });
    }
  }
  return diagnostics;
}
