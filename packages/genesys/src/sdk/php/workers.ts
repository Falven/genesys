import { posix } from "node:path";
import { parseDocument } from "yaml";
import type {
  AnalysisContext,
  AnalysisResult,
  Definition,
  Diagnostic,
  SourceEntry,
} from "../../contracts.js";
import { nestedPackageRoots, within } from "./source.js";
import { artifactPath, registrationGroups } from "./registration.js";

export function workers(
  context: AnalysisContext,
  diagnostics: Diagnostic[],
  definitions: Definition[],
): AnalysisResult["workers"] {
  const result: AnalysisResult["workers"] = [];
  const registrationFiles = registrationGroups(context, definitions)
    .filter((group) => !group.collision)
    .map(({ root }) => artifactPath(context, root));
  const nativeFiles = [
    ...new Set([...context.entries.map((entry) => entry.path), ...registrationFiles]),
  ].sort();
  const nestedPackages = nestedPackageRoots(context);
  const configs = [...context.sources].filter(
    ([path]) =>
      within(path, context.package.root) &&
      !nestedPackages.some((root) => within(path, root)) &&
      [".rr.yaml", ".rr.yml"].includes(posix.basename(path)),
  );
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of context.entries.filter(
    (entry) => entry.role === "worker" && entry.workerName,
  ))
    groups.set(entry.workerName!, [...(groups.get(entry.workerName!) ?? []), entry]);
  for (const [path] of configs) {
    const parts = path.split("/");
    const index = parts.lastIndexOf("workers");
    const workerName = index >= 0 && parts.length > index + 2 ? parts[index + 1] : undefined;
    if (workerName && !groups.has(workerName))
      groups.set(workerName, [
        {
          id: path,
          path,
          discoveryRoot: parts.slice(0, index + 1).join("/"),
          role: "worker",
          language: "php",
          packageId: context.package.id,
          workerName,
        },
      ]);
  }
  for (const [workerName, entries] of groups) {
    const workerDirectory = entries[0]!.path
      .split("/")
      .slice(0, entries[0]!.path.split("/").lastIndexOf("workers") + 2)
      .join("/");
    const candidates = configs.filter(
      ([path]) =>
        posix.dirname(path) === workerDirectory || posix.dirname(path) === context.package.root,
    );
    const local = candidates.filter(([path]) => posix.dirname(path) === workerDirectory);
    const selected = local.length ? local : candidates;
    const worker: AnalysisResult["workers"][number] = {
      id: `${context.package.id}:${workerName}`,
      name: workerName,
      language: "php",
      packageId: context.package.id,
      source: { path: entries[0]!.path },
      build: [
        {
          executable: "composer",
          args: ["install", "--no-interaction"],
          cwd: context.package.root,
        },
        ...nativeFiles.map((path) => ({
          executable: "php",
          args: ["-l", posix.relative(context.package.root, path)],
          cwd: context.package.root,
        })),
      ],
      readiness: {
        state: "unavailable",
        description:
          "RoadRunner owns Temporal pollers. Its pool Ready status and PHP WorkerFactory::run do not prove polling. Attribute native Worker heartbeats to the RoadRunner host PID and generation, then require fresh successful polls for each known task type. Dynamic Worker coverage and versioning can remain unknown.",
        evidence: [
          "RoadRunner host PID and start time",
          "native Worker heartbeat",
          "last_successful_poll_time",
          "native deployment drainage (retirement only)",
        ],
      },
    };
    if (selected.length !== 1 || (local.length === 0 && groups.size > 1)) {
      diagnostics.push({
        code: "php.worker-entrypoint",
        severity: "warning",
        source: worker.source,
        related: selected.map(([path]) => ({ path })),
        message: `Worker ${workerName} needs one unambiguous native RoadRunner config. Use a native executable override for unresolved launch environments; PHP scripts alone do not own pollers.`,
      });
    } else {
      const [path, content] = selected[0]!;
      try {
        const document = parseDocument(content, { uniqueKeys: true });
        if (document.errors.length) throw document.errors[0];
        const config = document.toJS({ maxAliasCount: 100 }) as {
          temporal?: unknown;
          server?: { command?: unknown };
        } | null;
        if (
          !config ||
          typeof config.temporal !== "object" ||
          !config.temporal ||
          typeof config.server?.command !== "string"
        )
          throw new Error("RoadRunner temporal configuration and server.command are required.");
        worker.start = {
          executable: "rr",
          args: ["serve", "-c", posix.basename(path)],
          cwd: posix.dirname(path),
        };
        worker.source = { path };
      } catch (error) {
        diagnostics.push({
          code: "php.roadrunner-config",
          severity: "warning",
          source: { path },
          message: `Cannot resolve native RoadRunner launch: ${String(error)}. Preserve native configuration and use an executable override.`,
        });
      }
    }
    if (context.mode === "production") {
      worker.nativeOutput = {
        paths: [
          context.package.root,
          ...registrationFiles,
          ...(worker.start ? [worker.source.path] : []),
        ],
        target: { runtime: "PHP" },
        runtimeRequirements: [
          "PHP CLI and the extensions required by the installed Composer packages",
          "RoadRunner with the Temporal plugin for RoadRunner startup",
        ],
      };
    }
    result.push(worker);
  }
  return result;
}
