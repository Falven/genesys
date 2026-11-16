import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisContext } from "../../contracts.js";
import { runTool } from "../tooling.js";
import type { Parsed } from "./model.js";

const assets = fileURLToPath(new URL("../../../sdk/java/", import.meta.url));
const inside = (path: string, root: string) => root === "." || path.startsWith(`${root}/`);
export const javaExecutable = () =>
  process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";

export function packageSources(context: AnalysisContext): [string, string][] {
  const nestedPackages = [...context.sources.keys()]
    .filter(
      (path) =>
        inside(path, context.package.root) &&
        ["pom.xml", "build.gradle", "build.gradle.kts"].includes(posix.basename(path)) &&
        posix.dirname(path) !== context.package.root,
    )
    .map(posix.dirname);
  return [...context.sources].filter(
    ([path]) =>
      path.endsWith(".java") &&
      inside(path, context.package.root) &&
      !nestedPackages.some((root) => inside(path, root)),
  );
}

export async function inspectSources(context: AnalysisContext): Promise<Parsed> {
  const scratch = await mkdtemp(join(tmpdir(), "genesys-java-"));
  try {
    const paths: string[] = [];
    for (const [path, content] of packageSources(context)) {
      const output = join(scratch, path);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content);
      paths.push(output);
    }
    if (!paths.length) return { types: [], diagnostics: [] };
    const input = join(scratch, "sources.txt");
    await writeFile(input, paths.sort().join("\n"));
    const pom = context.package.manifests.find((path) => path.endsWith("pom.xml"));
    if (pom) await writeFile(join(scratch, "pom.xml"), context.sources.get(pom)!);
    const stdout = await runTool({
      executable: javaExecutable(),
      args: [join(assets, "Inspect.java"), input, ...(pom ? [join(scratch, "pom.xml")] : [])],
      cwd: scratch,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Parsed;
    for (const type of parsed.types) type.path = relative(scratch, type.path).split("\\").join("/");
    for (const diagnostic of parsed.diagnostics)
      if (diagnostic.path)
        diagnostic.path = relative(scratch, diagnostic.path).split("\\").join("/");
    return parsed;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
