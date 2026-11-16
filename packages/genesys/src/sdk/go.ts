import { createAnalyzerAdapter } from "./adapter.js";
import { runTool } from "./tooling.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isGoWorkerCoverage,
  type GoWorkerCoverage,
  type WorkerProgram,
  type AnalysisResult,
  type EmissionResult,
} from "../contracts.js";

export const goAdapter = createAnalyzerAdapter({
  language: "go",
  async inspect(context) {
    const helper = fileURLToPath(new URL("../../src/sdk/go/", import.meta.url));
    const stdout = await runTool({
      executable: "go",
      args: ["run", ".", context.projectRoot, resolve(context.projectRoot, context.package.root)],
      cwd: helper,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        GOWORK: "off",
        GOFLAGS: "",
        GSYS_ANALYSIS_GOWORK: process.env.GOWORK ?? "",
        GSYS_ANALYSIS_GOFLAGS: process.env.GOFLAGS ?? "",
      },
      input: JSON.stringify(context.entries),
    });
    const result = JSON.parse(stdout) as { analysis: AnalysisResult; emission: EmissionResult };
    result.analysis.diagnostics.push(...result.emission.diagnostics);
    result.emission.diagnostics = [];
    return result;
  },
});

type GoWorkerCheck =
  | { state: "source"; sourceSha256: string }
  | { state: "bound"; proof: GoWorkerCoverage }
  | { state: "unknown"; reason: string };

export async function proveGoWorker(
  worker: WorkerProgram,
  sourceSha256?: string,
): Promise<GoWorkerCheck> {
  const start = worker.start;
  const build = worker.build?.[0];
  if (
    !start ||
    start.args.length ||
    start.env ||
    worker.build?.length !== 1 ||
    !build ||
    build.env ||
    build.executable !== "go" ||
    build.args.length !== 4 ||
    build.args[0] !== "build" ||
    build.args[1] !== "-o" ||
    build.args[2] !== start.executable ||
    build.cwd !== start.cwd
  )
    return {
      state: "unknown",
      reason: "Coverage requires the normal direct native Go build and launch plan.",
    };
  try {
    const nativeEnvironment = await runTool({
      executable: "go",
      args: ["env", "-json"],
      cwd: build.cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const environment: unknown = JSON.parse(nativeEnvironment);
    if (
      !environment ||
      typeof environment !== "object" ||
      Array.isArray(environment) ||
      !Object.values(environment).every((value) => typeof value === "string")
    )
      return { state: "unknown", reason: "Effective native Go build settings are unavailable." };
    const stdout = await runTool({
      executable: "go",
      args: ["run", ".", "--coverage"],
      cwd: fileURLToPath(new URL("../../src/sdk/go/", import.meta.url)),
      env: { ...process.env, GOWORK: "off", GOFLAGS: "" },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      input: JSON.stringify({
        beforeBuild: sourceSha256 === undefined,
        sourceSha256,
        packageRoot: build.cwd,
        target: build.args[3],
        executable: start.executable,
        environment,
      }),
    });
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== "object") throw new Error("Invalid Go coverage result.");
    if (
      sourceSha256 === undefined &&
      "sourceSha256" in result &&
      typeof result.sourceSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(result.sourceSha256)
    )
      return { state: "source", sourceSha256: result.sourceSha256 };
    if (
      sourceSha256 !== undefined &&
      "proof" in result &&
      isGoWorkerCoverage(result.proof) &&
      result.proof.executable === start.executable &&
      result.proof.cwd === start.cwd &&
      result.proof.sourceSha256 === sourceSha256
    )
      return { state: "bound", proof: result.proof };
    if ("reason" in result && typeof result.reason === "string")
      return { state: "unknown", reason: result.reason };
    throw new Error("Go coverage result lacks evidence or a reason.");
  } catch (error) {
    return {
      state: "unknown",
      reason: `Native coverage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
