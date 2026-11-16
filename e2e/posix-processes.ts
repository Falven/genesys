import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const supportsProcessGroups = process.platform === "darwin" || process.platform === "linux";

interface ProcessIdentity {
  pid: number;
  group: number;
  parent: number;
  started: string;
}

export async function liveProcesses(): Promise<ProcessIdentity[]> {
  const { stdout } = await execute("ps", ["-axo", "pid=,pgid=,ppid=,lstart=,stat="], {
    env: { ...process.env, LC_ALL: "C" },
    timeout: 5_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const processes: ProcessIdentity[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(\S+)\s*$/.exec(line);
    const started = match?.[4];
    if (!started) throw new Error(`Invalid native process record: ${line}`);
    if (match[5]?.startsWith("Z")) continue;
    processes.push({
      pid: Number(match[1]),
      group: Number(match[2]),
      parent: Number(match[3]),
      started,
    });
  }
  return processes;
}

export function sameProcess(a: ProcessIdentity, b: ProcessIdentity) {
  return a.pid === b.pid && a.group === b.group && a.started === b.started;
}

export function signalProcess(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

export function launchTree(byPid: ReadonlyMap<number, ProcessIdentity>, pid: number | undefined) {
  const members = new Set<number>();
  const root = pid === undefined ? undefined : byPid.get(pid);
  if (root?.parent !== process.pid) return members;
  for (const identity of byPid.values()) {
    for (
      let member: ProcessIdentity | undefined = identity;
      member && member.pid > 1;
      member = byPid.get(member.parent)
    ) {
      if (member.pid !== root.pid) continue;
      members.add(identity.pid);
      break;
    }
  }
  return members;
}

export function monitorProcessGroups(rootPid: () => number | undefined) {
  const known = new Map<number, ProcessIdentity[]>();
  const ended = new Set<number>();
  let pending: ReturnType<typeof scan> | undefined;

  async function scan() {
    const census = await liveProcesses();
    const byPid = new Map(census.map((identity) => [identity.pid, identity]));
    const descendants = launchTree(byPid, rootPid());

    const groups = new Map<number, ProcessIdentity[]>();
    for (const identity of census) {
      const members = groups.get(identity.group);
      if (members) members.push(identity);
      else groups.set(identity.group, [identity]);
    }
    for (const group of known.keys()) {
      if (groups.has(group)) continue;
      known.delete(group);
      ended.add(group);
    }

    const owned = new Map<number, ProcessIdentity[]>();
    for (const [group, members] of groups) {
      // A live member with the same creation identity keeps the detached group
      // attributable after its original parent or leader exits.
      const previous = known.get(group);
      if (
        members.some(
          (member) =>
            descendants.has(member.pid) ||
            previous?.some((identity) => sameProcess(member, identity)),
        )
      ) {
        ended.delete(group);
        known.set(group, members);
        owned.set(group, members);
      }
    }
    return { byPid, descendants, groups, owned };
  }

  function observe() {
    return (pending ??= scan().finally(() => {
      pending = undefined;
    }));
  }

  const interval = setInterval(() => {
    if (rootPid() !== undefined) void observe().catch(() => {});
  }, 250).unref();
  void observe().catch(() => {});

  return {
    current: async () => {
      await pending?.catch(() => {});
      return observe();
    },
    stop: () => clearInterval(interval),
    uncertainGroups(
      { byPid, groups, owned }: Awaited<ReturnType<typeof observe>>,
      reported: readonly number[],
    ) {
      const reportedGroups = reported.map((pid) => byPid.get(pid)?.group ?? pid);
      return [...new Set([...known.keys(), ...reportedGroups])].filter(
        (group) => !ended.has(group) && groups.has(group) && !owned.has(group),
      );
    },
  };
}
