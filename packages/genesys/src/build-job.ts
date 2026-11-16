import { writeFile } from "node:fs/promises";
import { buildProject } from "./build.js";

const [projectRoot, id, resultPath, ...excludedFiles] = process.argv.slice(2);
if (!projectRoot || !id || !resultPath) throw new Error("Missing internal build job arguments.");
try {
  const result = await buildProject(projectRoot, id, excludedFiles, "inherit", "development");
  for (const diagnostic of result.project.diagnostics) {
    const output = diagnostic.severity === "error" ? process.stderr : process.stdout;
    output.write(
      `${diagnostic.code}${diagnostic.source ? ` ${diagnostic.source.path}` : ""}: ${diagnostic.message}\n`,
    );
  }
  if (result.state === "published")
    await writeFile(resultPath, JSON.stringify(result.build), { flag: "wx" });
  else process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
