import { expect } from "vitest";

interface Generation {
  worker: string;
  buildId: string;
}

export function readinessReport(owner: { output(): string }, { worker, buildId }: Generation) {
  const prefix = `[${worker}@${buildId}] `;
  const lines = owner.output().split("\n");
  const start = lines.findLastIndex(
    (line) =>
      line.startsWith(prefix) &&
      /^(unknown|observed-ready|failed): /.test(line.slice(prefix.length)),
  );
  if (start < 0) return undefined;
  const summary = lines[start]?.slice(prefix.length);
  const instances: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(prefix)) break;
    const row = line.slice(prefix.length);
    if (!/^\S+\/\S+ queue=\S+ PID=\d+: (unknown|observed-ready)$/.test(row)) break;
    instances.push(row);
  }
  return { summary, instances };
}

export async function waitForObservedReady(owner: { output(): string }, generation: Generation) {
  await expect
    .poll(() => readinessReport(owner, generation), { timeout: 45_000 })
    .toMatchObject({
      summary: expect.stringMatching(/^observed-ready: /),
      instances: expect.arrayContaining([expect.stringMatching(/: observed-ready$/)]),
    });
}
