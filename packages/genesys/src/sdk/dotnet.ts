import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AnalysisContext,
  AnalysisResult,
  EmissionResult,
  NativeAdapter,
} from "../contracts.js";

const execute = promisify(execFile);
interface Result {
  analysis: AnalysisResult;
  emission: EmissionResult;
}
// Only the packaged helper is compiled, outside application MSBuild/global.json ancestry.
async function inspect(context: AnalysisContext): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), "genesys-dotnet-"));
  try {
    for (const file of ["Genesys.Analysis.csproj", "Program.cs"]) {
      const content = await readFile(new URL(`../../sdk/dotnet/${file}`, import.meta.url));
      await writeFile(join(directory, file), content);
    }
    await execute(
      "dotnet",
      [
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
      {
        cwd: directory,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, DOTNET_NOLOGO: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1" },
      },
    );
    const input = join(directory, "input.json");
    await writeFile(
      input,
      JSON.stringify({
        ...context,
        sources: Object.fromEntries(context.sources),
        suffix: createHash("sha256").update(context.package.id).digest("hex").slice(0, 12),
      }),
    );
    const { stdout } = await execute(
      "dotnet",
      [join(directory, "out/Genesys.Analysis.dll"), input],
      {
        cwd: directory,
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
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

const outputs = new WeakMap<AnalysisResult, EmissionResult>();

export const dotnetAdapter: NativeAdapter = {
  language: "dotnet",
  async analyze(context) {
    const result = await inspect(context);
    outputs.set(result.analysis, result.emission);
    return result.analysis;
  },
  async emit(context) {
    const output = outputs.get(context.analysis);
    if (!output)
      throw new Error(".NET emission requires the native analysis result from this process.");
    return output;
  },
};
