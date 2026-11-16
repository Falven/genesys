import { access } from "node:fs/promises";
import { delimiter, join, posix } from "node:path";
import type { AnalysisContext, Diagnostic, SourceEntry, WorkerProgram } from "../../contracts.js";
import { javaExecutable, packageSources } from "./inspection.js";
import { location, type JavaType, type Parsed } from "./model.js";

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
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (directory === ".") break;
  }
  return maven ? "mvn" : "gradle";
}

export async function planWorkers(context: AnalysisContext, parsed: Parsed) {
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
  const classes = maven ? (outputDirectory ?? "target/classes") : "build/genesys-worker";
  const libraries = maven ? "target/genesys-dependencies" : classes;

  function forType(type: JavaType, entry: SourceEntry) {
    const workers: WorkerProgram[] = [];
    const diagnostics: Diagnostic[] = [];
    const add = (code: string, message: string, source: JavaType) =>
      diagnostics.push({
        code: `java.${code}`,
        severity: "warning",
        message,
        source: location(source),
      } satisfies Diagnostic);
    for (const method of type.methods)
      if (
        method.name === "main" &&
        method.flags.includes("public") &&
        method.flags.includes("static") &&
        method.returns === "void" &&
        method.parameters.length === 1 &&
        ["String[]", "java.lang.String[]"].includes(method.parameters[0]!)
      ) {
        const packagePrefix = type.packageName ? `${type.packageName}.` : "";
        const mainClass =
          packagePrefix + type.name.slice(packagePrefix.length).replaceAll(".", "$");
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
                    `-DoutputDirectory=${libraries}`,
                  ]
                : ["--init-script", gradleScript, "gsysPrepareWorker", "-x", "test"],
            },
          ],
          start: {
            executable: javaExecutable(),
            cwd: context.package.root,
            args: ["-cp", [classes, `${libraries}/*`].join(delimiter), mainClass],
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
        if (context.mode === "production" && worker.start) {
          const outputRoot = posix.join(context.package.root, classes).replace(/\/$/, "");
          worker.nativeOutput = {
            paths: [outputRoot, posix.join(outputRoot, `${mainClass.replaceAll(".", "/")}.class`)],
            target: { runtime: "JVM" },
            runtimeRequirements: [
              "A JVM compatible with the application bytecode and runtime dependencies.",
              "Preserve the relative classpath layout in the retained build workspace.",
            ],
          };
        }
        workers.push(worker);
      }

    return { workers, diagnostics };
  }

  function finish(candidates: WorkerProgram[]) {
    let workers = candidates;
    const diagnostics: Diagnostic[] = [];
    const entries = new Map(context.entries.map((entry) => [entry.path, entry]));
    const workerDirectory = (path: string): string => {
      const directory = entries.get(path)?.workerDirectory;
      if (!directory) throw new Error(`Missing native Worker directory for ${path}.`);
      return directory;
    };
    const workerGroups = new Map<string, WorkerProgram[]>();
    for (const worker of workers) {
      const directory = workerDirectory(worker.source.path);
      workerGroups.set(directory, [...(workerGroups.get(directory) ?? []), worker]);
    }
    workers = [...workerGroups].map(([directory, candidates]) => {
      const first = candidates[0]!;
      if (candidates.length === 1) return first;
      diagnostics.push({
        code: "java.entrypoint-ambiguous",
        severity: "warning",
        source: first.source,
        related: candidates.slice(1).map((candidate) => candidate.source),
        message: `Several native main classes belong to Worker ${first.name}; supply an executable override. Candidates: ${candidates.map((candidate) => candidate.id).join(", ")}.`,
      });
      const { start: _start, ...unresolved } = first;
      if (unresolved.nativeOutput) {
        unresolved.nativeOutput = {
          ...unresolved.nativeOutput,
          paths: [...new Set(candidates.flatMap(({ nativeOutput }) => nativeOutput?.paths ?? []))],
        };
      }
      return { ...unresolved, id: `${context.package.id}:worker:${directory}` };
    });
    for (const entry of context.entries.filter(
      (entry) => entry.role === "worker" && entry.path.endsWith(".java"),
    )) {
      if (
        !entry.workerName ||
        workers.some(
          (worker) => workerDirectory(worker.source.path) === workerDirectory(entry.path),
        )
      )
        continue;
      diagnostics.push({
        code: "java.entrypoint-unresolved",
        severity: "warning",
        source: { path: entry.path },
        message:
          "No public static void main(String[]) entrypoint was found. Supply a native executable override for this named Worker.",
      });
      workers.push({
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
    for (const worker of workers) {
      if (
        context.mode !== "production" &&
        workers.some((other) => other.id !== worker.id && other.name === worker.name)
      )
        diagnostics.push({
          code: "java.entrypoint-ambiguous",
          severity: "error",
          source: worker.source,
          message: `Distinct native Worker directories share name ${worker.name}. Use unique directory names so Worker selection is unambiguous.`,
        });
    }
    if (workers.length && maven)
      diagnostics.push({
        code: "java.maven-layout",
        severity: "info",
        message:
          "Maven launch uses the resolved outputDirectory and copied runtime dependencies. Module-path applications and reactor-only dependencies require native executable assembly.",
      });

    return { workers, diagnostics };
  }

  return { forType, finish };
}
