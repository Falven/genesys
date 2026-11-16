#!/usr/bin/env node
import { writeDiscovery } from "./discovery.js";

import { analyzeProject } from "./sdk.js";
import { buildProject } from "./build.js";
import { runDev } from "./dev.js";
import { parseDevArgs } from "./dev-options.js";

const usage = `Usage: gsys <inspect|build|dev> [project-directory]
       gsys dev [project-directory] [--worker <name>]...
                [--worker-exec=<name>:<executable>]...
                [--worker-arg=<name>:<argument>]... [-- <temporal-arguments>...]

Inspect native Temporal definitions or generate registration and run native builds.
Inspect writes .gsys/discovery/manifest.json and diagnostics.json.
Build publishes an isolated version through .gsys/compile/manifest.json.
Dev starts managed Temporal and all discovered Workers, or only selected Workers.
Worker executable overrides replace the complete inferred startup command.
Worker arguments are ordered argv values; no shell evaluates them.
Arguments after -- go unchanged to temporal server start-dev.
Server paths use the invocation directory; Worker paths use the native package directory.
Build executes native package tooling. Inspect does not execute authored source.
`;

async function main(args: string[]): Promise<void> {
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]!))) {
    process.stdout.write(usage);
    return;
  }
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("0.0.0\n");
    return;
  }
  if (args[0] === "dev") {
    if (args.length === 2 && ["--help", "-h"].includes(args[1]!)) {
      process.stdout.write(usage);
      return;
    }
    const { projectPath, options } = parseDevArgs(args.slice(1));
    await runDev(projectPath, options);
    return;
  }
  if (!["inspect", "build"].includes(args[0]!) || args.length > 2 || args[1]?.startsWith("-")) {
    throw new Error(`Unsupported command or argument.\n${usage}`);
  }
  const path = args[1] ?? process.cwd();
  const built = args[0] === "build" ? await buildProject(path) : undefined;
  const result = built ? built.project : await analyzeProject(path);
  if (!built) await writeDiscovery(result);
  process.stdout.write(
    `${JSON.stringify(built?.state === "published" ? built.build : { ...result.manifest, workers: result.workers }, null, 2)}\n`,
  );
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(
      `${diagnostic.severity} ${diagnostic.code}${diagnostic.source ? ` ${diagnostic.source.path}` : ""}: ${diagnostic.message}\n`,
    );
  }
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`gsys: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
