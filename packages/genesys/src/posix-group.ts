import { execFile } from "node:child_process";
import type { OwnedPid } from "./owned-process.js";

/** The caller must hold the group leader alive for the entire observation. */
export function groupMembers(group: number): Promise<OwnedPid[]> {
  return new Promise((resolve, reject) => {
    const query = execFile(
      "ps",
      ["-axo", "pid=,pgid=,lstart=,stat="],
      {
        env: { ...process.env, LC_ALL: "C" },
        timeout: 5_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const members: OwnedPid[] = [];
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s*$/.exec(line);
            if (!match) throw new Error("Cannot read native process ownership from ps output.");
            const pid = Number(match[1]);
            if (Number(match[2]) !== group || pid === query.pid || match[4]?.startsWith("Z"))
              continue;
            const startedAt = Date.parse(match[3]!);
            if (!Number.isFinite(startedAt))
              throw new Error("Cannot read native process start time.");
            members.push({ pid, startedAt });
          }
          resolve(members);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
