import { operation, service } from "nexus-rpc";

export const inventory = service("TypeScriptInventory", {
  lookup: operation<string, string>({ name: "LookupOrder" }),
  reserve: operation<string, string>(),
});
