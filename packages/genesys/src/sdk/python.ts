import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  AnalysisContext,
  AnalysisResult,
  EmissionResult,
  NativeAdapter,
} from "../contracts.js";

async function inspect(context: AnalysisContext): Promise<AnalysisResult & EmissionResult> {
  const executable = process.platform === "win32" ? "python" : "python3";
  const helper = fileURLToPath(new URL("../../sdk/python/analyze.py", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      ["-I", helper],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Python static analysis requires Python 3.11 or later: ${stderr || error.message}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as AnalysisResult & EmissionResult);
        } catch (cause) {
          reject(new Error("Python static analyzer returned invalid JSON", { cause }));
        }
      },
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(
      JSON.stringify({
        projectRoot: context.projectRoot,
        package: context.package,
        entries: context.entries,
        sources: Object.fromEntries(context.sources),
      }),
    );
  });
}

export const pythonAdapter: NativeAdapter = {
  language: "python",
  async analyze(context) {
    const { definitions, diagnostics, workers } = await inspect(context);
    return { definitions, diagnostics, workers };
  },
  async emit(context) {
    const { artifacts, diagnostics } = await inspect(context);
    return { artifacts, diagnostics };
  },
};
