import type { ActivityInterceptorsFactory } from "@temporalio/worker";

export const prefixActivityResult: ActivityInterceptorsFactory = () => ({
  inbound: {
    async execute(input, next) {
      return `intercepted:${await next(input)}`;
    },
  },
});
