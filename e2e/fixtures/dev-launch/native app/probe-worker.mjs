import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";

export async function serve(name, command = "inferred") {
  const connectionSettings = JSON.parse(await readFile("worker-settings.json", "utf8"));
  const connection = await NativeConnection.connect({ address: connectionSettings.address });
  try {
    const worker = await Worker.create({
      connection,
      namespace: connectionSettings.namespace,
      taskQueue: name,
      workflowsPath: resolve("probe-workflow.cjs"),
      activities: {
        launchDetails: () => ({
          name,
          command,
          argv: process.argv.slice(2),
          cwd: process.cwd(),
          ...connectionSettings,
          connectionEnv: {
            TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS,
            TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE,
          },
        }),
      },
    });
    console.log(`launch probe ${name}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}
