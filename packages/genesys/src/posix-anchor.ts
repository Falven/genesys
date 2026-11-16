import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { groupMembers } from "./posix-group.js";

// This process occupies its group ID until every native child has exited.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
const send = (message: object): void => {
  if (process.connected)
    process.send?.(message, (error) => {
      if (error && process.connected) process.disconnect?.();
    });
};
let launched = false;
let leaderExited = false;
let ended = false;
let stopping = false;
function signal(force: boolean): void {
  if (ended) return;
  stopping = true;
  // Only this still-live group leader signals its own group. The supervisor never uses a PGID.
  process.kill(-process.pid, force ? "SIGKILL" : "SIGINT");
}
process.on("disconnect", () => signal(false));
process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || !("kind" in message)) return;
  if (message.kind === "signal" && "force" in message && typeof message.force === "boolean") {
    signal(message.force);
  } else if (
    message.kind === "launch" &&
    !launched &&
    "executable" in message &&
    typeof message.executable === "string" &&
    "args" in message &&
    Array.isArray(message.args) &&
    message.args.every((arg: unknown) => typeof arg === "string") &&
    "cwd" in message &&
    typeof message.cwd === "string"
  ) {
    launched = true;
    const child = spawn(message.executable, message.args, {
      cwd: message.cwd,
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    child.once("spawn", () => {
      send({ kind: "started", pid: child.pid });
      if (stopping) signal(false);
    });
    child.once("error", (error) => {
      leaderExited = true;
      send({ kind: "launch-error", message: error.message });
    });
    child.once("exit", (code, exitSignal) => {
      leaderExited = true;
      send({ kind: "exited", code, signal: exitSignal });
    });
    void monitor();
  } else if (message.kind === "members") {
    void groupMembers(process.pid).then(
      (members) =>
        send({ kind: "members", members: members.filter((member) => member.pid !== process.pid) }),
      (error: unknown) => send({ kind: "members-error", message: String(error) }),
    );
  }
});
async function monitor(): Promise<void> {
  let lastError: string | undefined;
  while (!ended) {
    try {
      if (
        leaderExited &&
        (await groupMembers(process.pid)).every((member) => member.pid === process.pid)
      ) {
        ended = true;
        if (process.connected) process.send?.({ kind: "done" }, () => process.disconnect?.());
        return;
      }
      lastError = undefined;
    } catch (error) {
      const message = String(error);
      if (message !== lastError) send({ kind: "ownership-warning", message });
      lastError = message;
    }
    await delay(500);
  }
}
