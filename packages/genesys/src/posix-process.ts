import { fork, type ChildProcess } from "node:child_process";
import type { Command } from "./contracts.js";
import type { OwnedPid, ProcessEvent, ProcessExit } from "./owned-process.js";

/** IPC to a retained group leader; no parent-side PID signaling is permitted. */
export class PosixProcess {
  readonly child: ChildProcess;
  pid: number | undefined;
  private readonly start = Promise.withResolvers<void>();
  private readonly exit = Promise.withResolvers<ProcessExit>();
  private readonly completion = Promise.withResolvers<void>();
  readonly started = this.start.promise;
  readonly exited = this.exit.promise;
  readonly done = this.completion.promise;
  private ended = false;
  private failure: Error | undefined;
  private membership: ReturnType<typeof Promise.withResolvers<OwnedPid[]>> | undefined;
  private queries: Promise<OwnedPid[]> = Promise.resolve([]);

  constructor(label: string, command: Command, emit: (event: ProcessEvent) => void) {
    this.child = fork(new URL("./posix-anchor.js", import.meta.url), [], {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
    });
    const fail = (error: Error): void => {
      if (this.failure || this.ended) return;
      this.failure = error;
      this.start.reject(error);
      this.exit.resolve({ code: null, signal: null });
      this.completion.reject(error);
      this.membership?.reject(error);
      this.membership = undefined;
      emit({ kind: "error", label, message: error.message });
    };
    this.child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object" || !("kind" in message))
        return fail(new Error("Invalid POSIX ownership record."));
      switch (message.kind) {
        case "started":
          if (!("pid" in message) || typeof message.pid !== "number")
            return fail(new Error("Invalid native process ID."));
          this.pid = message.pid;
          emit({
            kind: "status",
            label,
            message: `started PID ${message.pid}; cwd ${command.cwd}`,
          });
          this.start.resolve();
          break;
        case "exited":
          if (
            !("code" in message) ||
            !(message.code === null || typeof message.code === "number") ||
            !("signal" in message) ||
            !(message.signal === null || typeof message.signal === "string")
          )
            return fail(new Error("Invalid native exit record."));
          // Node's exit event supplies the native signal name.
          this.exit.resolve({
            code: message.code,
            signal: message.signal as NodeJS.Signals | null,
          });
          emit({
            kind: "status",
            label,
            message: `exited (${message.signal ?? message.code ?? "unknown"})`,
          });
          break;
        case "launch-error": {
          const error = new Error(
            "message" in message ? String(message.message) : "Native launch failed.",
          );
          this.start.reject(error);
          this.exit.resolve({ code: null, signal: null });
          emit({ kind: "error", label, message: error.message });
          break;
        }
        case "done":
          this.ended = true;
          this.membership?.resolve([]);
          this.membership = undefined;
          this.completion.resolve();
          break;
        case "members":
          if (
            !("members" in message) ||
            !Array.isArray(message.members) ||
            !message.members.every(
              (value: unknown): value is OwnedPid =>
                !!value &&
                typeof value === "object" &&
                "pid" in value &&
                typeof value.pid === "number" &&
                Number.isSafeInteger(value.pid) &&
                value.pid > 0 &&
                "startedAt" in value &&
                typeof value.startedAt === "number" &&
                Number.isFinite(value.startedAt),
            )
          )
            return fail(new Error("Invalid native group members."));
          this.membership?.resolve(message.members);
          this.membership = undefined;
          break;
        case "members-error":
          this.membership?.reject(
            new Error(
              "message" in message ? String(message.message) : "Native group enumeration failed.",
            ),
          );
          this.membership = undefined;
          break;
        case "ownership-warning":
          emit({
            kind: "error",
            label,
            message: `Ownership enumeration unavailable; retaining group: ${"message" in message ? String(message.message) : "unknown"}`,
          });
          break;
        default:
          fail(new Error("Unknown POSIX ownership record."));
      }
    });
    this.child.once("error", fail);
    this.child.once("disconnect", () =>
      fail(
        new Error(
          "POSIX ownership anchor disconnected without confirmed completion; retain the build.",
        ),
      ),
    );
    this.child.once("exit", () =>
      fail(
        new Error("POSIX ownership anchor exited without confirmed completion; retain the build."),
      ),
    );
    for (const kind of ["stdout", "stderr"] as const) {
      this.child[kind]?.setEncoding("utf8");
      this.child[kind]?.on("data", (message: string) => emit({ kind, label, message }));
    }
    this.child.once("spawn", () =>
      this.child.send(
        { kind: "launch", executable: command.executable, args: command.args, cwd: command.cwd },
        (error) => {
          if (error) fail(error);
        },
      ),
    );
    void this.started.catch(() => {});
    void this.done.catch(() => {});
  }

  liveProcesses(): Promise<OwnedPid[]> {
    this.queries = this.queries
      .catch(() => [])
      .then(async () => {
        await this.started;
        if (this.failure) throw this.failure;
        if (this.ended) return [];
        const request = Promise.withResolvers<OwnedPid[]>();
        this.membership = request;
        this.child.send({ kind: "members" }, (error) => {
          if (error) request.reject(error);
        });
        return request.promise;
      });
    return this.queries;
  }

  async signal(force: boolean): Promise<void> {
    await this.started.catch(() => {});
    if (this.failure) throw this.failure;
    if (this.ended) return;
    await new Promise<void>((resolve, reject) =>
      this.child.send({ kind: "signal", force }, (error) => (error ? reject(error) : resolve())),
    );
  }
}
