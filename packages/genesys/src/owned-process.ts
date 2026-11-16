import type { ChildProcess } from "node:child_process";
import { WindowsProcess, windowsHelper } from "./windows-process.js";
import { PosixProcess } from "./posix-process.js";
import { groupMembers } from "./posix-group.js";
import type { Command } from "./contracts.js";

export interface ProcessEvent {
  kind: "stdout" | "stderr" | "status" | "error";
  label: string;
  message: string;
}
export interface OwnedPid {
  pid: number;
  startedAt: number;
}
export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export function requireProcessOwnership(): void {
  if (process.platform === "win32") {
    windowsHelper();
    return;
  }
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error(`Managed process ownership is not implemented on ${process.platform}.`);
}

export async function prepareProcessOwnership(): Promise<void> {
  requireProcessOwnership();
  if (process.platform === "win32") return;
  try {
    await groupMembers(process.pid);
  } catch (error) {
    throw new Error(
      "Native process ownership requires ps with PID, process group, start time, and status fields. No managed processes were started.",
      { cause: error },
    );
  }
}

export class OwnedProcess {
  readonly label: string;
  readonly startedAt = Date.now();
  readonly child: ChildProcess;
  readonly started: Promise<void>;
  readonly exited: Promise<ProcessExit>;
  /** Resolves only on confirmed completion; ownership loss rejects and retains builds. */
  readonly done: Promise<void>;
  state: "starting" | "running" | "exited" = "starting";
  shutdownRequested = false;
  private readonly native: WindowsProcess | PosixProcess;

  constructor(label: string, command: Command, emit: (event: ProcessEvent) => void) {
    requireProcessOwnership();
    this.label = label;
    this.native =
      process.platform === "win32"
        ? new WindowsProcess(label, command, emit)
        : new PosixProcess(label, command, emit);
    this.child = this.native.child;
    this.started = this.native.started.then(() => {
      this.state = "running";
    });
    this.exited = this.native.exited.then((exit) => {
      this.state = "exited";
      return exit;
    });
    this.done = this.native.done;
    void this.started.catch(() => {});
    void this.done.catch(() => {});
  }

  get nativePid(): number | undefined {
    return this.native instanceof PosixProcess ? this.native.pid : undefined;
  }

  liveProcesses(): Promise<OwnedPid[]> {
    return this.native.liveProcesses();
  }

  async signal(force = false): Promise<void> {
    this.shutdownRequested = true;
    return this.native.signal(force);
  }
}
