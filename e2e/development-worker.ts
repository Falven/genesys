import {
  Connection,
  isGrpcServiceError,
  ServiceError,
  WorkflowClient,
  type WorkflowStartOptions,
} from "@temporalio/client";
import { randomUUID } from "node:crypto";
import { cp, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import type { temporalEndpoint } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/development-worker/", import.meta.url));
const goExample = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));

export async function prepareDevelopmentWorker(project: string) {
  await Promise.all([
    cp(source, project, { recursive: true }),
    cp(join(goExample, "go.mod"), join(project, "go.mod")),
    cp(join(goExample, "go.sum"), join(project, "go.sum")),
  ]);
}

export async function editDevelopmentWorker(project: string, version: string) {
  const authored = await readFile(join(source, "version.go"), "utf8");
  await writeFile(
    join(project, "version.go"),
    authored.replace(
      'const sourceVersion = "v1"',
      `const sourceVersion = ${JSON.stringify(version)}`,
    ),
  );
}

export function selectedDevelopmentManifest(project: string) {
  return join(project, ".gsys", "compile", "manifest.json");
}

export async function waitForDevelopmentBuild(
  owner: { output(): string },
  project: string,
  previousId?: string,
  worker = "lifecycle",
) {
  const projectRoot = await realpath(project);
  return vi.waitFor(
    async () => {
      const selected: unknown = JSON.parse(
        await readFile(selectedDevelopmentManifest(project), "utf8"),
      );
      if (
        !selected ||
        typeof selected !== "object" ||
        !("id" in selected) ||
        typeof selected.id !== "string"
      )
        throw new Error("Selected build manifest is missing an ID");
      const { id } = selected;
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect(id).not.toBe(previousId);
      const directory = join(projectRoot, ".gsys", "compile", "builds", id);
      const root = join(directory, "project");
      const manifestPath = join(directory, "manifest.json");
      expect(selected).toMatchObject({ id, root, manifestPath });
      const launch = owner
        .output()
        .match(new RegExp(`^\\[${worker}@${id}\\] started PID (\\d+); cwd (.+)$`, "m"));
      if (!launch) throw new Error(`Worker for selected build ${id} has not launched`);
      expect(launch[2]).toBe(root);
      return { id, root, manifestPath, pid: Number(launch[1]) };
    },
    { timeout: 60_000 },
  );
}

export async function withDevelopmentClient<T>(
  endpoint: Awaited<ReturnType<typeof temporalEndpoint>>,
  run: (client: WorkflowClient) => Promise<T>,
) {
  const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
  try {
    await connection.ensureConnected();
    await expect
      .poll(
        () =>
          connection.withDeadline(Date.now() + 2_000, () =>
            connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
    return await run(new WorkflowClient({ connection, namespace: endpoint.namespace }));
  } finally {
    await connection.close();
  }
}

type Observation = { version: string; pid: number; cwd: string };
type DevelopmentProbe = (hold: boolean) => Promise<Observation>;

export async function startDevelopmentProbe(
  client: WorkflowClient,
  version: string,
  {
    hold = false,
    startDelay,
  }: { hold?: boolean; startDelay?: WorkflowStartOptions<DevelopmentProbe>["startDelay"] } = {},
) {
  const deploymentVersion = { deploymentName: "lifecycle", buildId: version };
  const workflowId = randomUUID();
  const failedPrecondition = 9;
  return vi.waitUntil(
    async () => {
      try {
        return await client.connection.withDeadline(Date.now() + 5_000, () =>
          client.start<DevelopmentProbe>("LifecycleProbe", {
            taskQueue: "lifecycle",
            workflowId,
            workflowExecutionTimeout: hold ? "4m" : "30s",
            versioningOverride: { pinnedTo: deploymentVersion },
            startDelay,
            args: [hold],
          }),
        );
      } catch (error) {
        if (
          error instanceof ServiceError &&
          isGrpcServiceError(error.cause) &&
          error.cause.code === failedPrecondition &&
          error.cause.details.includes(
            `Pinned version 'lifecycle:${version}' is not present in task queue`,
          )
        )
          return;
        throw error;
      }
    },
    {
      timeout: 20_000,
      interval: 250,
      message: `Wait for Temporal to accept a Workflow pinned to ${version}`,
    },
  );
}
