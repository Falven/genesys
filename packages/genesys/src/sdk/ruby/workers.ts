import { posix } from "node:path";
import type { AnalysisContext, Definition, Diagnostic, WorkerProgram } from "../../contracts.js";
import { constant, invocation, token, type ParsedFile } from "./source.js";

export function workerPrograms({
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
    workers.push(worker);
  }
  diagnostics.push(...registrationDiagnostics(files, definitions, resolveName, ownsSource));
  return { workers, diagnostics };
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
