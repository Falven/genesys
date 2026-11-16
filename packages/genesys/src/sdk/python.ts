import { fileURLToPath } from "node:url";
import type { AnalysisContext, AnalysisResult, EmissionResult } from "../contracts.js";
import { createAnalyzerAdapter } from "./adapter.js";
import { runTool } from "./tooling.js";

async function inspect(context: AnalysisContext) {
  const stdout = await runTool({
    executable: process.platform === "win32" ? "python" : "python3",
    args: ["-I", fileURLToPath(new URL("../../sdk/python/analyze.py", import.meta.url))],
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    input: JSON.stringify({
      projectRoot: context.projectRoot,
      package: context.package,
      entries: context.entries,
      sources: Object.fromEntries(context.sources),
    }),
  });
  let result: AnalysisResult & EmissionResult;
  try {
    result = JSON.parse(stdout) as AnalysisResult & EmissionResult;
  } catch (cause) {
    throw new Error("Python static analyzer returned invalid JSON", { cause });
  }
  const { definitions, diagnostics, workers, artifacts } = result;
  return {
    analysis: { definitions, diagnostics, workers },
    emission: { artifacts, diagnostics },
  };
}

export const pythonAdapter = createAnalyzerAdapter({ language: "python", inspect });
