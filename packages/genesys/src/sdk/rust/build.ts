import { spawn } from "node:child_process";
import { isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Command, WorkerProgram } from "../../contracts.js";
import { commandEnvironment, windowsCommand } from "../../windows-command.js";

function cargoMessage(line: string): unknown {
  if (line.startsWith("{")) {
    try {
      return JSON.parse(line);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
}

export async function buildRustProgram(
  root: string,
  worker: WorkerProgram,
  original: Command,
): Promise<void> {
  const command = windowsCommand(original, true);
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: commandEnvironment(command),
    windowsVerbatimArguments: command.windowsVerbatimArguments,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const finished = new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      code === 0 ? accept() : reject(new Error(`${command.executable} failed (${signal ?? code})`)),
    );
  });
  const manifest = join(command.cwd, "Cargo.toml");
  const executables = new Set<string>();
  const collect = async () => {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const message = cargoMessage(line);
      if (!message || typeof message !== "object" || !("reason" in message)) {
        process.stderr.write(`${line}\n`);
        continue;
      }
      if (
        message.reason === "compiler-artifact" &&
        "manifest_path" in message &&
        message.manifest_path === manifest &&
        "target" in message &&
        message.target &&
        typeof message.target === "object" &&
        "name" in message.target &&
        message.target.name === worker.name &&
        "kind" in message.target &&
        Array.isArray(message.target.kind) &&
        message.target.kind.includes("bin") &&
        "executable" in message &&
        typeof message.executable === "string"
      )
        executables.add(message.executable);
      if (
        message.reason === "compiler-message" &&
        "message" in message &&
        message.message &&
        typeof message.message === "object" &&
        "rendered" in message.message &&
        typeof message.message.rendered === "string"
      )
        process.stderr.write(message.message.rendered);
    }
  };
  await Promise.all([finished, collect()]);
  if (!executables.size) throw new Error(`Cargo did not report an executable for ${worker.id}.`);

  worker.nativeOutput = {
    paths: [...executables].sort().map((executable) => {
      const path = relative(root, executable);
      if (
        !isAbsolute(executable) ||
        !path ||
        path === ".." ||
        path.startsWith(`..${sep}`) ||
        isAbsolute(path)
      )
        throw new Error(`Cargo executable for ${worker.id} is outside the build: ${executable}`);
      return path.split(sep).join("/");
    }),
    runtimeRequirements: [
      "An environment compatible with the selected Cargo target and any dynamic libraries or application runtime files it requires.",
    ],
  };
  const [executable] = executables;
  if (executable && executables.size === 1)
    worker.start = { executable, args: [], cwd: command.cwd };
}
