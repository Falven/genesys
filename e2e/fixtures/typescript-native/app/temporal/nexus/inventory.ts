import { OperationError, serviceHandler as handleService } from "nexus-rpc";
import { inventory } from "../lib/service.js";

const warehouse = "east";

export const inventoryHandler = handleService(inventory, {
  lookup: async (_ctx, name) => `${warehouse}:${name}`,
  reserve: async (_ctx, name) => {
    throw new OperationError("failed", `${warehouse} is out of ${name}`);
  },
});
