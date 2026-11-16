import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { Command } from "./contracts.js";
import type { OwnedPid, ProcessEvent, ProcessExit } from "./owned-process.js";
import { commandEnvironment, windowsCommand, windowsCommandLine } from "./windows-command.js";

export function windowsHelper(): string {
  if (process.arch !== "x64" && process.arch !== "arm64")
    throw new Error(
      `Windows process ownership requires x64 or arm64 Node.js, received ${process.arch}.`,
    );
  const path = fileURLToPath(
    new URL(`../native/owned-process-win32-${process.arch}.exe`, import.meta.url),
  );
  accessSync(path, constants.R_OK);
  return path;
}

function launchData(command: Command): Buffer {
  const chunks: Buffer[] = [];
  for (const value of [command.executable, command.cwd, windowsCommandLine(command)]) {
    const text = Buffer.from(value, "utf16le");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(text.length);
    chunks.push(length, text);
  }
  return Buffer.concat(chunks);
}

/** Internal bridge to one private console and one atomically assigned Windows Job Object. */
export class WindowsProcess {
  readonly child: ChildProcess;
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

  constructor(label: string, original: Command, emit: (event: ProcessEvent) => void) {
    const command = windowsCommand(original);
    this.child = spawn(windowsHelper(), [], {
      cwd: command.cwd,
      env: commandEnvironment(command),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    const fail = (error: Error): void => {
      if (this.failure) return;
      this.failure = error;
      this.start.reject(error);
      this.exit.resolve({ code: null, signal: null });
      this.completion.reject(error);
      this.membership?.reject(error);
      this.membership = undefined;
      emit({ kind: "error", label, message: error.message });
    };
    const decoders = { O: new StringDecoder("utf8"), R: new StringDecoder("utf8") };
    let pending = Buffer.alloc(0);
    let started = false;
    let leaderExited = false;
    const frame = (kind: string, payload: Buffer): void => {
      const text = payload.toString("utf8");
      switch (kind) {
        case "P": {
          if (started || !/^\d+$/.test(text))
            throw new Error("Invalid Windows helper start record.");
          started = true;
          emit({ kind: "status", label, message: `started PID ${text}; cwd ${command.cwd}` });
          this.start.resolve();
          break;
        }
        case "E": {
          if (!started || leaderExited || !/^\d+$/.test(text))
            throw new Error("Invalid Windows helper exit record.");
          leaderExited = true;
          const code = Number(text);
          emit({ kind: "status", label, message: `exited (${code})` });
          this.exit.resolve({ code, signal: null });
          break;
        }
        case "D":
          if (!leaderExited || payload.length)
            throw new Error("Invalid Windows helper completion record.");
          this.ended = true;
          this.membership?.resolve([]);
          this.membership = undefined;
          this.completion.resolve();
          this.child.stdin?.end();
          break;
        case "M": {
          if (!this.membership) throw new Error("Unexpected Windows job membership record.");
          const members: OwnedPid[] = [];
          for (const line of text.split("\n").filter(Boolean)) {
            const match = /^(\d+) (\d+)$/.exec(line);
            if (!match) throw new Error("Invalid Windows job membership record.");
            const pid = Number(match[1]);
            const startedAt = Number(match[2]);
            if (
              !Number.isSafeInteger(pid) ||
              pid <= 0 ||
              !Number.isSafeInteger(startedAt) ||
              startedAt <= 0
            )
              throw new Error("Invalid Windows process identity.");
            members.push({ pid, startedAt });
          }
          this.membership.resolve(members);
          this.membership = undefined;
          break;
        }
        case "O":
        case "R": {
          const message = decoders[kind].write(payload);
          if (message) emit({ kind: kind === "O" ? "stdout" : "stderr", label, message });
          break;
        }
        case "Q": {
          const error = new Error(`Windows job membership unavailable: ${text}`);
          if (!this.membership) throw error;
          this.membership.reject(error);
          this.membership = undefined;
          break;
        }
        case "X":
          fail(new Error(`Windows process ownership failed: ${text}`));
          break;
        default:
          throw new Error(`Unknown Windows helper record: ${kind}`);
      }
    };
    this.child.stdout?.on("data", (chunk: Buffer) => {
      try {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 5) {
          const length = pending.readUInt32LE(1);
          if (length > 16 * 1024 * 1024) throw new Error("Invalid Windows helper frame length.");
          if (pending.length < 5 + length) break;
          frame(String.fromCharCode(pending[0]!), pending.subarray(5, 5 + length));
          pending = pending.subarray(5 + length);
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        // Closing the helper closes its kill-on-close job, never an unrelated process tree.
        this.child.kill();
      }
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (message: string) => emit({ kind: "error", label, message }));
    this.child.once("error", fail);
    this.child.stdin?.on("error", fail);
    this.child.once("close", (code) => {
      for (const kind of ["O", "R"] as const) {
        const message = decoders[kind].end();
        if (message) emit({ kind: kind === "O" ? "stdout" : "stderr", label, message });
      }
      if (!this.ended || pending.length || code !== 0)
        fail(
          new Error(
            `Windows ownership helper exited without confirmed completion (${code ?? "unknown"}); retain the build.`,
          ),
        );
    });
    this.child.stdin?.write(launchData(command));
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
        this.membership = Promise.withResolvers<OwnedPid[]>();
        this.child.stdin?.write("L");
        return this.membership.promise;
      });
    return this.queries;
  }

  async signal(force: boolean): Promise<void> {
    await this.started.catch(() => {});
    if (this.failure) throw this.failure;
    if (!this.ended) this.child.stdin?.write(force ? "F" : "G");
  }
}
