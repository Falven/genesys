import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "./tooling.js";
import { createAnalyzerAdapter } from "./adapter.js";
import type { AnalysisContext, AnalysisResult, EmissionResult } from "../contracts.js";

interface Result {
  analysis: AnalysisResult;
  emission: EmissionResult;
}
async function inspect(context: AnalysisContext): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), "genesys-dotnet-"));
  try {
    const assets = new URL("../../sdk/dotnet/", import.meta.url);
    const sourceFiles = (await readdir(assets)).filter(
      (file) => file.endsWith(".cs") || file === "Genesys.Analysis.csproj",
    );
    for (const file of sourceFiles) {
      const content = await readFile(new URL(`../../sdk/dotnet/${file}`, import.meta.url));
      await writeFile(join(directory, file), content);
    }
    await runTool({
      executable: "dotnet",
      args: [
        "build",
        "Genesys.Analysis.csproj",
        "--nologo",
        "-v:q",
        "-o",
        "out",
        "-p:ImportDirectoryBuildProps=false",
        "-p:ImportDirectoryBuildTargets=false",
        "-p:NuGetAudit=false",
      ],
      cwd: directory,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, DOTNET_NOLOGO: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1" },
    });
    const input = join(directory, "input.json");
    await writeFile(
      input,
      JSON.stringify({
        ...context,
        sources: Object.fromEntries(context.sources),
        suffix: createHash("sha256").update(context.package.id).digest("hex").slice(0, 12),
      }),
    );
    const stdout = await runTool({
      executable: "dotnet",
      args: [join(directory, "out/Genesys.Analysis.dll"), input],
      cwd: directory,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Result;
  } catch (error) {
    const diagnostic = {
      code: "dotnet.analysis-unavailable",
      severity: "error" as const,
      source: { path: context.package.root },
      message: `C# analysis requires .NET SDK 10 and restore access for the isolated Roslyn helper. Application code was not executed. ${error instanceof Error ? error.message : String(error)}`,
    };
    return {
      analysis: { definitions: [], diagnostics: [diagnostic], workers: [] },
      emission: { artifacts: [], diagnostics: [diagnostic] },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const dotnetAdapter = createAnalyzerAdapter({ language: "dotnet", inspect });
