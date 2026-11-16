import {
  condition,
  createNexusServiceClient,
  defineUpdate,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { activityMap } from "../../activities/order.js";
import { orderName } from "../../lib/order.js";
import { inventory } from "../../lib/service.js";

const activities = proxyActivities<typeof activityMap & { legacy(name: string): Promise<string> }>({
  startToCloseTimeout: "5s",
  retry: { maximumAttempts: 1 },
});

export const approve = defineUpdate<string, [string]>("approve");

export function validateOrder(name: string) {
  if (!name.trim()) throw new Error("An order name is required");
}

async function checkout() {
  let approved = "";
  setHandler(
    approve,
    (name) => {
      approved = orderName(name);
      return approved;
    },
    { validator: validateOrder },
  );
  await condition(() => approved !== "");
  return Promise.all([
    activities.stamp(approved),
    activities.legacy(approved),
    activities.label(approved),
  ]);
}

export { checkout as Checkout };

export function NexusProbe(action: "lookup" | "reserve", name: string) {
  const client = createNexusServiceClient({ endpoint: "ts-inventory", service: inventory });
  return client.executeOperation(action, name, { scheduleToCloseTimeout: "10s" });
}

export default async function fallback() {
  return `fallback:${workflowInfo().workflowType}`;
}
