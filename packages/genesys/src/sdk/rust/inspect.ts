import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisContext } from "../../contracts.js";
import { runTool } from "../tooling.js";
import type { RustAnalysis } from "./model.js";

function analyzerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
    "RUSTC",
    "CARGO_BUILD_RUSTC",
    "CARGO_TARGET_DIR",
  ])
    delete env[name];
  return env;
}

export async function inspect(context: AnalysisContext): Promise<RustAnalysis> {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../sdk/rust/analyzer");
  await access(join(source, "Cargo.lock"));
  const directory = await mkdtemp(join(tmpdir(), "genesys-rust-analyzer-"));
  try {
    await mkdir(join(directory, "src"));
    const files = [
      "Cargo.toml",
      "Cargo.lock",
      ...(await readdir(join(source, "src")))
        .filter((file) => file.endsWith(".rs"))
        .map((file) => `src/${file}`),
    ];
    for (const path of files)
      await writeFile(join(directory, path), await readFile(join(source, path)));
    const invocation = {
      cwd: directory,
      env: analyzerEnvironment(),
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    };
    const version = await runTool({ ...invocation, executable: "rustc", args: ["-vV"] });
    const host = /^host: (\S+)$/m.exec(version)?.[1];
    if (!host) throw new Error("rustc did not report the analyzer's host target.");
    const targetDir = join(directory, "target");
    await runTool({
      ...invocation,
      executable: "cargo",
      args: [
        "build",
        "--locked",
        "--manifest-path",
        join(directory, "Cargo.toml"),
        "--target",
        host,
        "--target-dir",
        targetDir,
      ],
    });
    const executable = join(
      targetDir,
      host,
      "debug",
      `genesys-rust-analyzer${process.platform === "win32" ? ".exe" : ""}`,
    );
    const input = JSON.stringify({
      root: context.package.root,
      sources: Object.fromEntries(context.sources),
      entries: Object.fromEntries(context.entries.map((entry) => [entry.path, entry.role])),
    });
    return JSON.parse(
      await runTool({ ...invocation, executable, args: [], input }),
    ) as RustAnalysis;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
