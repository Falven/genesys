import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Command, GoWorkerCoverage, WorkerProgram } from "./contracts.js";
import type { WorkerGeneration } from "./dev.js";
import type { DecideRetirement } from "./dev-replacement.js";
import {
  freshReadiness,
  observationFreshness,
  observeWorker,
  type ManagedConnection,
} from "./native-observation.js";

export type NativeCoverage =
  | { state: "unknown"; reason: string }
  | { state: "known"; proof: GoWorkerCoverage; pid: number; startedAt: number };

export async function checkGoLaunch(
  program: WorkerProgram,
  command: Command,
): Promise<{ proof?: GoWorkerCoverage; reason: string }> {
  const proof = program.coverage;
  if (
    !proof ||
    proof.platform !== process.platform ||
    proof.architecture !== (process.arch === "x64" ? "amd64" : process.arch) ||
    proof.executable !== command.executable ||
    proof.cwd !== command.cwd ||
    command.args.length ||
    command.env
  )
    return {
      reason: "No complete checked coverage for this native build and unchanged direct launch.",
    };
  const environment = process.env;
  if (
    Object.entries(environment).some(
      ([key, value]) =>
        value && (key === "NODE_OPTIONS" || key.startsWith("LD_") || key.startsWith("DYLD_")),
    )
  )
    return {
      reason: "Helper/native loader environment can execute code outside the checked Go closure.",
    };
  try {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(command.executable)) digest.update(chunk);
    if (digest.digest("hex") !== proof.sha256)
      return { reason: "Native executable no longer matches its checked build." };
    return {
      proof,
      reason:
        "Compiled native closure and direct executable launch are bound; runtime instance evidence is still required.",
    };
  } catch (error) {
    return {
      reason: `Native executable binding unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function completeNativeEvidence(
  generation: WorkerGeneration,
  address: string,
  now: number,
): boolean {
  const coverage = generation.coverage;
  const observed = generation.observation.instances[0];
  if (
    coverage.state !== "known" ||
    generation.observation.coverage.state !== "observed-snapshot" ||
    !freshReadiness(generation.observation, now) ||
    generation.observation.instances.length !== 1 ||
    !observed
  )
    return false;
  return (
    observed.pid === coverage.pid &&
    observed.processStartedAt === coverage.startedAt &&
    observed.taskQueue === coverage.proof.taskQueue &&
    observed.address === address &&
    observed.sdkName === "temporal-go" &&
    observed.sdkVersion === coverage.proof.sdkVersion &&
    observed.heartbeatDeployment === undefined &&
    observed.versioning.mode === "unversioned" &&
    observed.versioningAt !== undefined &&
    observed.versioningAt <= now &&
    now - observed.versioningAt <= observationFreshness &&
    !observed.polls.some(
      (poll) =>
        (poll.active || poll.lastSuccessfulPollAt !== undefined) &&
        !coverage.proof.taskTypes.some((type) => type === poll.taskType),
    ) &&
    coverage.proof.taskTypes.every((type) =>
      observed.polls.some(
        (poll) =>
          poll.taskType === type &&
          poll.lastSuccessfulPollAt !== undefined &&
          poll.lastSuccessfulPollAt >= observed.startedAt &&
          poll.lastSuccessfulPollAt <= now &&
          now - poll.lastSuccessfulPollAt <= observationFreshness,
      ),
    )
  );
}

/** Only checked native Go closures can turn an observed heartbeat into complete coverage. */
export function nativeRetirement(connection: ManagedConnection): DecideRetirement {
  return async (previous, replacement, signal) => {
    signal.throwIfAborted();
    if (connection.state !== "known") return { state: "unknown", reason: connection.reason };
    for (const generation of [previous, replacement]) {
      if (generation.coverage.state === "unknown")
        return {
          state: "unknown",
          reason: `${generation.program.name}: ${generation.coverage.reason} Heartbeat snapshots alone omit disabled or delayed Workers. Drained status and closed-only reachability do not exclude pinned overrides or closed-Workflow Queries.`,
        };
    }
    const oldCoverage = previous.coverage;
    const newCoverage = replacement.coverage;
    if (oldCoverage.state !== "known" || newCoverage.state !== "known")
      return { state: "unknown", reason: "Native program coverage is unknown." };
    if (
      oldCoverage.proof.taskQueue !== newCoverage.proof.taskQueue ||
      JSON.stringify(oldCoverage.proof.taskTypes) !== JSON.stringify(newCoverage.proof.taskTypes)
    )
      return {
        state: "unknown",
        reason: "Checked previous/replacement task queues or remote task types differ.",
      };
    for (const generation of [previous, replacement]) {
      generation.observation = await observeWorker(
        connection,
        generation.process,
        signal,
        generation.observation,
      );
      if (!completeNativeEvidence(generation, connection.address, Date.now()))
        return {
          state: "unknown",
          reason:
            "Fresh native evidence does not match the checked single unversioned Go Worker and all expected remote task types.",
        };
    }
    if (
      previous.observation.instances[0]!.namespace !==
      replacement.observation.instances[0]!.namespace
    )
      return { state: "unknown", reason: "Native previous/replacement namespaces differ." };
    const owned = [];
    for (const generation of [previous, replacement])
      owned.push({ generation, live: await generation.process.liveProcesses() });
    const now = Date.now();
    for (const { generation, live } of owned) {
      const coverage = generation.coverage;
      if (
        coverage.state !== "known" ||
        generation.process.nativePid !== coverage.pid ||
        generation.process.state !== "running" ||
        generation.process.shutdownRequested ||
        live.length !== 1 ||
        live[0]?.pid !== coverage.pid ||
        live[0].startedAt !== coverage.startedAt ||
        !completeNativeEvidence(generation, connection.address, now)
      )
        return {
          state: "unknown",
          reason:
            "Bound native process identity or complete task-type evidence changed before retirement.",
        };
    }
    signal.throwIfAborted();
    return {
      state: "eligible",
      reason:
        "Both compiled/direct Go programs have complete single-Worker coverage with fresh native unversioned evidence on the same namespace, queue and remote task types. Request native graceful shutdown; retain the build until group completion. Registration and replay compatibility remain application responsibilities.",
    };
  };
}
