import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker as TemporalWorker } from "@temporalio/worker";
import { activities } from "../../temporal/genesys-activities.js";
import { nexusServices } from "../../temporal/genesys-nexus.js";
import { prefixActivityResult } from "./lib/options.js";

async function run() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
  try {
    const worker = await TemporalWorker.create({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE,
      taskQueue: readFileSync("task-queue.txt", "utf8").trim(),
      workflowsPath: fileURLToPath(
        new URL("../../temporal/genesys-workflows.mjs", import.meta.url),
      ),
      activities: { ...activities, label: async (name: string) => `authored:${name}` },
      nexusServices,
      interceptors: { activity: [prefixActivityResult] },
    });
    await worker.run();
  } finally {
    await connection.close();
  }
}

await run();
