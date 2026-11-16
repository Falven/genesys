import { appendFileSync } from "node:fs";

function mark(event: string) {
  if (process.env.GENESYS_TS_MARKER) appendFileSync(process.env.GENESYS_TS_MARKER, `${event}\n`);
}

mark("activity import");

class Orders {
  constructor(private readonly store: string) {
    mark("activity constructor");
  }

  async stamp(name: string) {
    return `${this.store}:${name}`;
  }
}

const orders = new Orders("orders");

export const activityMap = {
  stamp: orders.stamp.bind(orders),
  label: async (name: string) => `generated:${name}`,
};
