import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import type { OwnedProcess } from "./owned-process.js";
import { nativeConnection, nativeRead } from "./native-api.js";

export type ManagedConnection =
  | { state: "known"; address: string; namespaces: string[] }
  | { state: "unknown"; reason: string };
export type TaskType = "workflow" | "activity" | "nexus";
export interface NativeInstance {
  address: string;
  namespace: string;
  instanceKey: string;
  identity: string;
  sdkName: string | undefined;
  sdkVersion: string | undefined;
  taskQueue: string;
  host: string;
  pid: number;
  startedAt: number;
  processStartedAt: number;
  heartbeatAt: number;
  observedAt: number;
  status: "running" | "shutting-down" | "shutdown" | "unknown";
  polls: { taskType: TaskType; lastSuccessfulPollAt: number | undefined; active: boolean }[];
  capabilityCoverage: "observed-only";
  heartbeatDeployment: { deploymentName: string; buildId: string } | undefined;
  versioningAt: number | undefined;
  readiness: "unknown" | "observed-ready";
  reason: string;
  versioning:
    | { mode: "deployment"; deploymentName: string; buildId: string }
    | { mode: "legacy"; buildId: string }
    | { mode: "unversioned" }
    | { mode: "unknown"; reason: string };
}
export interface WorkerObservation {
  observedAt: number;
  readiness: "unknown" | "observed-ready" | "failed";
  reason: string;
  instances: NativeInstance[];
  /** Snapshot of native heartbeat enumeration, never proof of future application behavior. */
  coverage: { state: "observed-snapshot" | "unknown"; reason: string };
}

const execute = promisify(execFile);
export const observationFreshness = 120_000;
const maximumWorkers = 256;

/** Derive only native flags whose endpoint semantics are known. Never change launch args. */
export function managedConnection(args: readonly string[]): ManagedConnection {
  let host = "localhost";
  let port = "7233";
  const namespaces = new Set(["default"]);
  const valueFlags = new Set([
    "--db-filename",
    "-f",
    "--dynamic-config-value",
    "--http-port",
    "--metrics-port",
    "--search-attribute",
    "--sqlite-pragma",
    "--ui-asset-path",
    "--ui-codec-endpoint",
    "--ui-ip",
    "--ui-port",
    "--ui-public-path",
    "--color",
    "--log-format",
    "--log-level",
    "--output",
    "-o",
    "--time-format",
    "--command-timeout",
    "--client-connect-timeout",
  ]);
  const booleanFlags = new Set([
    "--headless",
    "--log-config",
    "--ui-disable-news-fetch",
    "--disable-config-env",
    "--disable-config-file",
    "--no-json-shorthand-payloads",
  ]);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const equal = argument.indexOf("=");
    const flag = equal < 0 ? argument : argument.slice(0, equal);
    if (["--ip", "--port", "-p", "--namespace", "-n"].includes(flag)) {
      const value = equal < 0 ? args[++index] : argument.slice(equal + 1);
      if (!value) return { state: "unknown", reason: `Missing native value for ${flag}.` };
      if (flag === "--ip") host = value;
      else if (flag === "--port" || flag === "-p") port = value;
      else namespaces.add(value);
    } else if (/^-(?:p|n).+/.test(argument) && !argument.startsWith("--")) {
      if (argument[1] === "p") port = argument.slice(2);
      else namespaces.add(argument.slice(2));
    } else if (valueFlags.has(flag)) {
      if (equal < 0) index++;
    } else if (booleanFlags.has(flag)) {
      continue;
    } else {
      return {
        state: "unknown",
        reason: `Native connection configuration ${flag} cannot be resolved for observation.`,
      };
    }
  }
  if (
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    ["", "0.0.0.0", "::", "[::]"].includes(host)
  )
    return {
      state: "unknown",
      reason: "Native bind address or ephemeral port cannot be resolved for observation.",
    };
  const address = `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${Number(port)}`;
  return { state: "known", address, namespaces: [...namespaces] };
}

export async function queryTemporal(
  connection: Extract<ManagedConnection, { state: "known" }>,
  namespace: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<unknown> {
  const { stdout } = await execute(
    "temporal",
    [
      ...args,
      "--address",
      connection.address,
      "--namespace",
      namespace,
      "--disable-config-env",
      "--disable-config-file",
      "--command-timeout",
      "5s",
      "--client-connect-timeout",
      "3s",
      "--output",
      "json",
    ],
    { timeout: 8_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", signal, killSignal: "SIGKILL" },
  );
  return JSON.parse(stdout) as unknown;
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a native JSON object.");
  return Object.fromEntries(Object.entries(value));
}
export function field(value: Record<string, unknown>, camel: string): unknown {
  return value[camel] ?? value[camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
}
export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing native ${label}.`);
  return value;
}
export function time(value: unknown, label: string): number {
  const result = Date.parse(text(value, label));
  if (!Number.isFinite(result)) throw new Error(`Invalid native ${label}.`);
  return result;
}
function heartbeat(value: unknown): Record<string, unknown> {
  const object = record(value);
  return field(object, "workerHeartbeat") === undefined
    ? object
    : record(field(object, "workerHeartbeat"));
}
function attribution(value: unknown): {
  key: string;
  host: string;
  pid: number;
  startedAt: number;
} {
  const worker = heartbeat(value);
  const host = field(worker, "hostInfo") === undefined ? worker : record(field(worker, "hostInfo"));
  const pidText = text(field(host, "processId"), "process ID");
  if (!/^\d+$/.test(pidText) || !Number.isSafeInteger(Number(pidText)) || Number(pidText) < 1)
    throw new Error("Invalid native process ID.");
  return {
    key: text(field(worker, "workerInstanceKey"), "instance key"),
    host: text(field(host, "hostName"), "host name"),
    pid: Number(pidText),
    startedAt: time(field(worker, "startTime"), "Worker start time"),
  };
}

function instance(
  value: unknown,
  connection: Extract<ManagedConnection, { state: "known" }>,
  namespace: string,
  processStartedAt: number,
): NativeInstance {
  const worker = heartbeat(value);
  const owner = attribution(value);
  const observedAt = Date.now();
  const heartbeatAt = time(field(worker, "heartbeatTime"), "heartbeat time");
  const nativeStatus = field(worker, "status");
  const status: NativeInstance["status"] =
    nativeStatus === "WORKER_STATUS_RUNNING" || nativeStatus === 1
      ? "running"
      : nativeStatus === "WORKER_STATUS_SHUTTING_DOWN" || nativeStatus === 2
        ? "shutting-down"
        : nativeStatus === "WORKER_STATUS_SHUTDOWN" || nativeStatus === 3
          ? "shutdown"
          : "unknown";
  const polls: NativeInstance["polls"] = [];
  for (const taskType of ["workflow", "activity", "nexus"] as const) {
    const info = field(worker, `${taskType}PollerInfo`);
    if (info === undefined || info === null) continue;
    const successful = field(record(info), "lastSuccessfulPollTime");
    const currentPollers = field(record(info), "currentPollers") ?? 0;
    if (
      typeof currentPollers !== "number" ||
      !Number.isInteger(currentPollers) ||
      currentPollers < 0
    )
      throw new Error("Invalid native current poller count.");
    polls.push({
      taskType,
      lastSuccessfulPollAt:
        successful == null ? undefined : time(successful, "successful poll time"),
      active: currentPollers > 0,
    });
  }
  const recent = (sample: number): boolean =>
    sample >= owner.startedAt &&
    sample <= observedAt &&
    observedAt - sample <= observationFreshness;
  const ready =
    status === "running" &&
    recent(heartbeatAt) &&
    polls.some(
      (poll) => poll.lastSuccessfulPollAt !== undefined && recent(poll.lastSuccessfulPollAt),
    );
  let versioning: NativeInstance["versioning"] = {
    mode: "unknown",
    reason: "Absence of deployment metadata does not establish unversioned operation.",
  };
  let heartbeatDeployment: NativeInstance["heartbeatDeployment"];
  const deployment = field(worker, "deploymentVersion");
  if (deployment !== undefined && deployment !== null) {
    const version = record(deployment);
    const deploymentName = field(version, "deploymentName");
    const buildId = field(version, "buildId");
    if (
      (deploymentName != null && typeof deploymentName !== "string") ||
      (buildId != null && typeof buildId !== "string")
    )
      throw new Error("Invalid native heartbeat deployment identity.");
    if (deploymentName || buildId)
      heartbeatDeployment = { deploymentName: deploymentName ?? "", buildId: buildId ?? "" };
    if (
      typeof deploymentName === "string" &&
      deploymentName &&
      typeof buildId === "string" &&
      buildId
    )
      versioning = { mode: "deployment", deploymentName, buildId };
  }
  return {
    address: connection.address,
    namespace,
    instanceKey: owner.key,
    identity: text(field(worker, "workerIdentity"), "Worker identity"),
    sdkName:
      typeof field(worker, "sdkName") === "string" ? String(field(worker, "sdkName")) : undefined,
    sdkVersion:
      typeof field(worker, "sdkVersion") === "string"
        ? String(field(worker, "sdkVersion"))
        : undefined,
    taskQueue: text(field(worker, "taskQueue"), "Task Queue"),
    host: owner.host,
    pid: owner.pid,
    startedAt: owner.startedAt,
    processStartedAt,
    heartbeatAt,
    observedAt,
    status,
    polls,
    capabilityCoverage: "observed-only",
    heartbeatDeployment,
    versioningAt: undefined,
    readiness: ready ? "observed-ready" : "unknown",
    reason:
      status !== "running"
        ? `Native Worker status is ${status}; replacement readiness requires explicit RUNNING status.`
        : ready
          ? "Recent attributed RUNNING heartbeat and successful native polling; unused poller structures do not prove enabled capabilities."
          : "Recent attributed heartbeat and successful native polling are not yet available.",
    versioning,
  };
}

export function unknownObservation(reason: string): WorkerObservation {
  return {
    observedAt: Date.now(),
    readiness: "unknown",
    reason,
    instances: [],
    coverage: {
      state: "unknown",
      reason: "Native instance enumeration has not completed.",
    },
  };
}

/** All RPCs are read-only. CLI pagination finishes or fails within the query bounds. */
export async function observeWorker(
  connection: ManagedConnection,
  process: OwnedProcess,
  signal?: AbortSignal,
  prior?: WorkerObservation,
): Promise<WorkerObservation> {
  const result = unknownObservation(
    "No fresh Worker heartbeat has been attributed to this process group on the managed service.",
  );
  if (connection.state === "unknown") return { ...result, reason: connection.reason };
  const native = nativeConnection(connection.address);
  try {
    signal?.throwIfAborted();
    const owned = await process.liveProcesses();
    if (!owned.length)
      return { ...result, readiness: "failed", reason: "No live owned processes." };
    const namespaces = new Set(connection.namespaces);
    const deadline = Date.now() + 30_000;
    let queries = 0;
    const query = (namespace: string, args: readonly string[]): Promise<unknown> => {
      signal?.throwIfAborted();
      if (++queries > 64 || Date.now() >= deadline)
        throw new Error("Native observation query budget exceeded; evidence is incomplete.");
      return queryTemporal(connection, namespace, args, signal);
    };
    const failures: string[] = [];
    const identities = new Map<string, number>();
    try {
      const discovered = await query("default", ["operator", "namespace", "list"]);
      if (!Array.isArray(discovered) || discovered.length > 64)
        throw new Error("Namespace enumeration is incomplete or exceeds 64 namespaces.");
      for (const value of discovered)
        namespaces.add(
          text(field(record(field(record(value), "namespaceInfo")), "name"), "namespace name"),
        );
    } catch (error) {
      failures.push(
        `Namespace enumeration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const namespace of namespaces) {
      signal?.throwIfAborted();
      try {
        const listed = await query(namespace, [
          "worker",
          "list",
          "--limit",
          String(maximumWorkers + 1),
        ]);
        if (!Array.isArray(listed) || listed.length > maximumWorkers)
          throw new Error("Worker enumeration is incomplete or exceeds 256 Workers.");
        for (const value of listed) {
          signal?.throwIfAborted();
          // Older CLI versions list complete WorkerInfo; newer versions list WorkerListInfo.
          let candidate: ReturnType<typeof attribution>;
          try {
            candidate = attribution(value);
          } catch (error) {
            failures.push(
              `${namespace}: Worker attribution unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
            continue;
          }
          const listedWorker = heartbeat(value);
          const identity = text(field(listedWorker, "workerIdentity"), "Worker identity");
          const queue = text(field(listedWorker, "taskQueue"), "Task Queue");
          const identityKey = JSON.stringify([namespace, queue, identity]);
          identities.set(identityKey, (identities.get(identityKey) ?? 0) + 1);
          const pid = owned.find((entry) => entry.pid === candidate.pid);
          if (
            candidate.host !== hostname() ||
            !pid ||
            candidate.startedAt < pid.startedAt ||
            candidate.startedAt < process.startedAt
          )
            continue;
          const described = await query(namespace, [
            "worker",
            "describe",
            "--worker-instance-key",
            candidate.key,
          ]);
          const observed = instance(described, connection, namespace, pid.startedAt);
          const live = await process.liveProcesses();
          if (
            observed.instanceKey !== candidate.key ||
            observed.host !== candidate.host ||
            observed.pid !== candidate.pid ||
            observed.startedAt !== candidate.startedAt ||
            !live.some((entry) => entry.pid === observed.pid && entry.startedAt === pid.startedAt)
          )
            throw new Error("Worker identity changed during native observation.");
          result.instances.push(observed);
        }
      } catch (error) {
        failures.push(`${namespace}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const observed of result.instances) {
      const old = prior?.instances.find(
        (entry) =>
          entry.namespace === observed.namespace && entry.instanceKey === observed.instanceKey,
      );
      for (const poll of old?.polls ?? []) {
        const current = observed.polls.find((entry) => entry.taskType === poll.taskType);
        if (current) {
          current.active ||= poll.active;
          current.lastSuccessfulPollAt ??= poll.lastSuccessfulPollAt;
        } else observed.polls.push(poll);
      }
      if (
        identities.get(
          JSON.stringify([observed.namespace, observed.taskQueue, observed.identity]),
        ) !== 1
      ) {
        observed.versioning = {
          mode: "unknown",
          reason: "Poller identity is shared by multiple native Worker instances.",
        };
        continue;
      }
      // Java can report a deployment label even in unversioned mode. Confirm mode from polls.
      const heartbeatVersion = observed.versioning;
      try {
        const modes: NativeInstance["versioning"][] = [];
        const modeTimes: number[] = [];
        for (const poll of observed.polls.filter(
          (entry) => entry.lastSuccessfulPollAt !== undefined || entry.active,
        )) {
          signal?.throwIfAborted();
          if (++queries > 64 || Date.now() >= deadline)
            throw new Error(
              "Native observation query budget exceeded; mode evidence is incomplete.",
            );
          const response = await nativeRead(native, signal, (service) =>
            service.describeTaskQueue({
              namespace: observed.namespace,
              taskQueue: { name: observed.taskQueue, kind: 1 },
              taskQueueType: { workflow: 1, activity: 2, nexus: 3 }[poll.taskType],
            }),
          );
          const matches = response.pollers.filter((entry) => entry.identity === observed.identity);
          if (!matches.length)
            modes.push({
              mode: "unknown",
              reason: "No attributable native poller mode on the queried partition.",
            });
          for (const match of matches) {
            const accessedAt =
              Number(match.lastAccessTime?.seconds) * 1_000 +
              (match.lastAccessTime?.nanos ?? 0) / 1_000_000;
            if (
              !Number.isFinite(accessedAt) ||
              accessedAt < observed.startedAt ||
              accessedAt > Date.now() ||
              Date.now() - accessedAt > observationFreshness
            ) {
              modes.push({ mode: "unknown", reason: "Native poller mode evidence is stale." });
              continue;
            }
            modeTimes.push(accessedAt);
            modes.push(pollerVersioning(record(match)));
          }
        }
        if (
          modes.length &&
          modes.every(
            (mode) => mode.mode !== "unknown" && JSON.stringify(mode) === JSON.stringify(modes[0]),
          )
        ) {
          observed.versioning = modes[0]!;
          observed.versioningAt = Math.min(...modeTimes);
        } else
          observed.versioning = {
            mode: "unknown",
            reason:
              modes.find((mode) => mode.mode === "unknown")?.reason ??
              "Native pollers do not establish one versioning mode.",
          };
        if (
          heartbeatVersion.mode === "deployment" &&
          observed.versioning.mode === "deployment" &&
          JSON.stringify(heartbeatVersion) !== JSON.stringify(observed.versioning)
        )
          observed.versioning = {
            mode: "unknown",
            reason: "Native heartbeat and poller deployment identities disagree.",
          };
      } catch (error) {
        observed.versioning = {
          mode: "unknown",
          reason: `Native poller mode unavailable: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    for (const old of prior?.instances ?? []) {
      if (
        !result.instances.some(
          (entry) => entry.namespace === old.namespace && entry.instanceKey === old.instanceKey,
        )
      ) {
        failures.push(
          `${old.namespace}/${old.instanceKey}: previously observed instance is missing from native enumeration.`,
        );
        result.instances.push({
          ...old,
          readiness: "unknown",
          reason: "Previously observed instance is missing from native enumeration.",
        });
      }
    }
    signal?.throwIfAborted();
    result.observedAt = Date.now();
    if (
      result.instances.length &&
      result.instances.every(
        (entry) =>
          entry.readiness === "observed-ready" &&
          result.observedAt - entry.heartbeatAt <= observationFreshness,
      )
    ) {
      result.readiness = "observed-ready";
      result.reason =
        "Observed native instances have recent heartbeats and successful polls. Capability coverage is limited to observed task types; delayed or heartbeat-disabled Workers are not enumerated.";
    }
    if (!failures.length && result.instances.length)
      result.coverage = {
        state: "observed-snapshot",
        reason:
          "Enumerated the managed service namespaces and native heartbeats. Authored connections must match this service; delayed or heartbeat-disabled instances and future capabilities are not proven.",
      };
    if (failures.length) {
      result.readiness = "unknown";
      result.reason = `Native observation incomplete: ${failures.join("; ")}`;
    }
    return result;
  } catch (error) {
    if (signal?.aborted) return unknownObservation("Native observation cancelled.");
    for (const old of prior?.instances ?? []) {
      if (
        !result.instances.some(
          (entry) => entry.namespace === old.namespace && entry.instanceKey === old.instanceKey,
        )
      )
        result.instances.push({
          ...old,
          readiness: "unknown",
          reason: "Native enumeration failed.",
        });
    }
    return {
      ...result,
      reason: `Native observation unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await native.close();
  }
}

/** A fresh readiness claim expires even when no newer observation is available. */
export function freshReadiness(observation: WorkerObservation, now = Date.now()): boolean {
  return (
    observation.readiness === "observed-ready" &&
    observation.observedAt <= now &&
    now - observation.observedAt <= observationFreshness &&
    observation.instances.length > 0 &&
    observation.instances.every(
      (entry) =>
        entry.status === "running" &&
        entry.heartbeatAt <= now &&
        now - entry.heartbeatAt <= observationFreshness &&
        entry.polls.some(
          (poll) =>
            poll.lastSuccessfulPollAt !== undefined &&
            poll.lastSuccessfulPollAt >= entry.startedAt &&
            poll.lastSuccessfulPollAt <= now &&
            now - poll.lastSuccessfulPollAt <= observationFreshness,
        ),
    )
  );
}

function pollerVersioning(poller: Record<string, unknown>): NativeInstance["versioning"] {
  const options = field(poller, "deploymentOptions");
  if (options != null) {
    const deployment = record(options);
    const mode = field(deployment, "workerVersioningMode");
    if (mode === 1 || mode === "WORKER_VERSIONING_MODE_UNVERSIONED") return { mode: "unversioned" };
    if (mode === 2 || mode === "WORKER_VERSIONING_MODE_VERSIONED")
      return {
        mode: "deployment",
        deploymentName: text(field(deployment, "deploymentName"), "deployment name"),
        buildId: text(field(deployment, "buildId"), "deployment Build ID"),
      };
    return {
      mode: "unknown",
      reason: "Native deployment options have no explicit versioning mode.",
    };
  }
  const capabilities = field(poller, "workerVersionCapabilities");
  if (capabilities != null) {
    const version = record(capabilities);
    if (field(version, "deploymentSeriesName"))
      return {
        mode: "unknown",
        reason: "Deprecated deployment-series versioning has no supported drainage evidence.",
      };
    const useVersioning = field(version, "useVersioning");
    if (useVersioning === true)
      return { mode: "legacy", buildId: text(field(version, "buildId"), "legacy Build ID") };
    // In a present protobuf capabilities message, omitted use_versioning is false.
    if (useVersioning === false || useVersioning === undefined) return { mode: "unversioned" };
  }
  return { mode: "unknown", reason: "Native poller versioning metadata is absent or unsupported." };
}
