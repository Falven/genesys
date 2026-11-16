import { readdirSync } from "node:fs";
import { watch, type FSWatcher } from "chokidar";
import { lstat, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { runtimePathKey, cleanupBuild, type PublishedBuild } from "./build.js";
import type { WorkerProgram } from "./contracts.js";
import type { DevSession, WorkerGeneration } from "./dev.js";
import { startBuildJob } from "./dev-build.js";
import type { OwnedProcess } from "./owned-process.js";
import { freshReadiness } from "./native-observation.js";

export type RetirementDecision = { state: "eligible" | "unknown" | "required"; reason: string };
export type DecideRetirement = (
  previous: WorkerGeneration,
  replacement: WorkerGeneration,
  signal: AbortSignal,
) => Promise<RetirementDecision>;

const excluded = new Set([
  ".git",
  ".gsys",
  "node_modules",
  "vendor",
  "target",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
]);
const generatedHeader = /^(?:<\?php\r?\n)?(?:\/\/|#) (?:Code generated|Generated) by Genesys\./;
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Serial builds; native readiness and retirement remain separate decisions. */
export class DevelopmentReplacement {
  private readonly watcher: FSWatcher;
  private readonly session: DevSession;
  private readonly select: (build: PublishedBuild) => WorkerProgram[];
  private readonly decideRetirement: DecideRetirement;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private pending = false;
  private watching = false;
  private changesInFlight = 0;
  private forced = false;
  private running: Promise<void> | undefined;
  private buildProcess: OwnedProcess | undefined;
  private readonly builds = new Set<PublishedBuild>();
  private readonly ended = new Set<WorkerGeneration>();
  private readonly newest = new Map<string, WorkerGeneration>();
  private readonly generated = new Set<string>();
  private readonly generatedDirectories = new Set<string>();
  private readonly decisions = new Map<WorkerGeneration, string>();
  private cleanup: Promise<void> = Promise.resolve();
  private retirement: Promise<void> | undefined;

  constructor(
    session: DevSession,
    select: (build: PublishedBuild) => WorkerProgram[],
    decideRetirement: DecideRetirement = async () => ({
      state: "unknown",
      reason: "Native retirement eligibility is unknown; retaining this Worker and its build.",
    }),
  ) {
    this.session = session;
    this.select = select;
    this.decideRetirement = decideRetirement;
    this.watcher = watch(".", {
      cwd: session.projectRoot,
      backend: "native",
      followSymlinks: false,
      ignoreInitial: true,
      ignored: (path) => {
        const local = relative(session.projectRoot, resolve(session.projectRoot, path)).replaceAll(
          "\\",
          "/",
        );
        return this.ignoredPath(local) || this.nativeOutput(local);
      },
    });
    this.watcher.on("all", (_event, filename) => {
      this.changesInFlight++;
      void this.changed(filename)
        .catch((error: unknown) => this.watcherFailed(error))
        .finally(() => {
          this.changesInFlight--;
        });
    });
    this.watcher.on("error", (error) => this.watcherFailed(error));
    this.watcher.once("ready", () => {
      this.watching = true;
      this.requestBuild();
    });
  }

  private ignoredPath(path: string): boolean {
    return (
      this.session.runtimeFiles.some(
        (file) => runtimePathKey(file) === runtimePathKey(resolve(this.session.projectRoot, path)),
      ) ||
      path.split("/").some((part) => excluded.has(part)) ||
      this.generated.has(path) ||
      [...this.generatedDirectories].some((directory) => path.startsWith(`${directory}/`))
    );
  }

  private watcherFailed(error: unknown): void {
    if (this.abort.signal.aborted || this.session.isStopping) return;
    process.exitCode = 1;
    this.error(
      new Error(
        `Source watching failed; stopping the owned development session. ${message(error)}`,
      ),
    );
    void this.session.shutdown();
  }

  private async changed(filename: string): Promise<void> {
    const path = filename.replaceAll("\\", "/");
    if (this.ignoredPath(path) || this.nativeOutput(path)) return;
    if (/\.(?:go|java|kt|cs|fs|vb|php|py|rb|rs|[cm]?[jt]sx?)$/.test(path)) {
      try {
        const file = join(this.session.projectRoot, path);
        if (
          !(await lstat(file)).isSymbolicLink() &&
          generatedHeader.test(await readFile(file, "utf8"))
        )
          return;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            ["ENOENT", "EISDIR"].includes(String(error.code))
          )
        )
          throw error;
      }
    }
    this.requestBuild();
  }

  private nativeOutput(path: string): boolean {
    const parts = path.split("/");
    const index = parts.findIndex((part) => ["build", "bin", "obj"].includes(part.toLowerCase()));
    if (index < 0) return false;
    for (let depth = index; depth >= 0; depth--) {
      let names: string[];
      try {
        names = readdirSync(join(this.session.projectRoot, ...parts.slice(0, depth)));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
      if (parts[index]?.toLowerCase() === "build") {
        if (
          names.some((name) =>
            [
              "pom.xml",
              "build.gradle",
              "build.gradle.kts",
              "package.json",
              "pyproject.toml",
              "setup.py",
              "setup.cfg",
            ].includes(name),
          )
        )
          return true;
      } else if (names.some((name) => /\.(?:cs|fs|vb)proj$/.test(name))) return true;
    }
    return false;
  }

  private requestBuild(): void {
    if (this.abort.signal.aborted || this.session.isStopping) return;
    this.revision++;
    this.pending = true;
    if (!this.watching) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.running) return;
      this.running = this.drain().finally(() => {
        this.running = undefined;
      });
    }, 250);
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.abort.signal.aborted && !this.session.isStopping) {
      this.pending = false;
      const revision = this.revision;
      try {
        this.session.report({
          kind: "status",
          label: "build",
          message: "Building source changes while existing Workers remain active.",
        });
        const job = await startBuildJob(
          this.session.projectRoot,
          (event) => this.session.report(event),
          this.session.runtimeFiles,
        );
        this.buildProcess = job.process;
        if (this.abort.signal.aborted || this.session.isStopping)
          await job.process.signal(this.forced);
        const build = await job.result;
        this.builds.add(build);
        const inputs = new Set(build.inputs.map((input) => input.path));
        const ignoredArtifacts: string[] = [];
        for (const artifact of build.artifacts) {
          if (!inputs.has(artifact.path)) {
            this.generated.add(artifact.path);
            ignoredArtifacts.push(artifact.path);
            if (artifact.entry.kind === "directory") this.generatedDirectories.add(artifact.path);
          }
        }
        if (!this.abort.signal.aborted) this.watcher.unwatch(ignoredArtifacts);
        if (this.abort.signal.aborted || this.session.isStopping || revision !== this.revision)
          continue;
        const workers = await this.session.startWorkers(build, this.select(build));
        for (const worker of workers) {
          void worker.process.done.then(
            () => {
              this.ended.add(worker);
              this.scheduleCleanup();
            },
            (error: unknown) => {
              process.exitCode = 1;
              this.error(
                new Error(
                  `Process ownership failed; retaining the Worker build. ${message(error)}`,
                ),
              );
              void this.session.shutdown().catch((failure: unknown) => this.error(failure));
            },
          );
        }
        if (
          revision !== this.revision ||
          workers.some((worker) => worker.process.state !== "running")
        ) {
          this.session.report({
            kind: "status",
            label: "build",
            message: "Candidate is superseded or failed startup; previous Workers remain active.",
          });
          continue;
        }
        for (const worker of workers) this.newest.set(worker.program.name, worker);
        this.session.report({
          kind: "status",
          label: "build",
          message: `Started build ${build.id}; waiting for native readiness and retirement evidence. Temporal routing is unchanged; overlapping Workers require compatible native registrations and replay behavior or native Worker Versioning.`,
        });
      } catch (error) {
        if (!this.abort.signal.aborted)
          this.error(
            new Error(
              `Replacement failed; existing Workers and Temporal remain active. Watching for edits. ${message(error)}`,
            ),
          );
      } finally {
        this.buildProcess = undefined;
        this.scheduleCleanup();
      }
    }
  }

  /** Called after fresh native observations; never treats spawn or logs as readiness. */
  observe(): Promise<void> {
    if (this.retirement) return this.retirement;
    this.retirement = this.retire().finally(() => {
      this.retirement = undefined;
    });
    return this.retirement;
  }

  private async retire(): Promise<void> {
    if (this.pending || this.running || this.changesInFlight || this.abort.signal.aborted) return;
    const revision = this.revision;
    for (const previous of this.session.workers) {
      const replacement = this.newest.get(previous.program.name);
      if (
        !replacement ||
        replacement === previous ||
        this.ended.has(previous) ||
        previous.process.shutdownRequested ||
        previous.process.state !== "running" ||
        replacement.process.state !== "running" ||
        !freshReadiness(replacement.observation)
      )
        continue;
      let decision: RetirementDecision;
      try {
        decision = await this.decideRetirement(previous, replacement, this.abort.signal);
      } catch (error) {
        decision = {
          state: "unknown",
          reason: `Native retirement query failed: ${message(error)}`,
        };
      }
      if (
        this.abort.signal.aborted ||
        this.session.isStopping ||
        this.pending ||
        this.running ||
        this.changesInFlight ||
        revision !== this.revision ||
        this.newest.get(previous.program.name) !== replacement ||
        replacement.process.state !== "running" ||
        !freshReadiness(replacement.observation) ||
        replacement.process.shutdownRequested ||
        previous.process.state !== "running" ||
        previous.process.shutdownRequested
      )
        return;
      const summary = `${decision.state}: ${decision.reason}`;
      if (this.decisions.get(previous) !== summary) {
        this.decisions.set(previous, summary);
        this.session.report({ kind: "status", label: previous.process.label, message: summary });
      }
      if (decision.state === "eligible")
        await previous.process.signal().catch((error: unknown) => this.error(error));
    }
  }

  private scheduleCleanup(): void {
    this.cleanup = this.cleanup
      .then(async () => {
        const builds = [...this.builds];
        for (const build of builds) {
          const required = new Set(
            this.session.workers
              .filter((worker) => !this.ended.has(worker))
              .map((worker) => worker.build.id),
          );
          if (await cleanupBuild(build, required)) this.builds.delete(build);
        }
      })
      .catch((error: unknown) => this.error(new Error(`Build cleanup failed: ${message(error)}`)));
  }

  async finishCleanup(): Promise<void> {
    this.scheduleCleanup();
    await this.cleanup;
  }

  async stop(force = false): Promise<void> {
    this.forced ||= force;
    this.abort.abort();
    const watcherClosed = this.watcher.close();
    if (this.timer) clearTimeout(this.timer);
    await this.buildProcess?.signal(force).catch((error: unknown) => this.error(error));
    await watcherClosed;
    await this.running;
    await this.retirement;
    await this.cleanup;
  }

  private error(error: unknown): void {
    this.session.report({ kind: "error", label: "gsys", message: message(error) });
  }
}
