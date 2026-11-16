import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Command } from "./contracts.js";

/** Windows environment keys are case-insensitive; overrides replace inherited keys. */
export function commandEnvironment(command: Command): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const [key, value] of Object.entries(command.env ?? {})) {
    if (process.platform === "win32")
      for (const inherited of Object.keys(environment))
        if (inherited.toLowerCase() === key.toLowerCase()) delete environment[inherited];
    environment[key] = value;
  }
  return environment;
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

function executablePath(executable: string, cwd: string, environment: NodeJS.ProcessEnv): string {
  const directories =
    /[\\/]/.test(executable) || isAbsolute(executable)
      ? [cwd]
      : [cwd, ...(environmentValue(environment, "PATH") ?? "").split(delimiter)];
  const extensions = extname(executable) ? [""] : [".exe", ".com", ".cmd", ".bat"];
  for (const directory of directories)
    for (const extension of extensions) {
      const candidate = resolve(cwd, directory.replace(/^"(.*)"$/, "$1"), executable + extension);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  throw new Error(`Cannot resolve Windows executable ${executable} from ${cwd}.`);
}

function nodeShim(executable: string): string | undefined {
  const name = basename(executable)
    .replace(/\.(?:cmd|bat)$/i, "")
    .toLowerCase();
  const packages: Record<string, string> = {
    npm: "npm",
    npx: "npm",
    pnpm: "pnpm",
    pnpx: "pnpm",
    yarn: "yarn",
    yarnpkg: "yarn",
    tsx: "tsx",
    "ts-node": "ts-node",
    tsc: "typescript",
  };
  const packageName = packages[name];
  if (!packageName) return undefined;
  const directory = dirname(executable);
  // npm global shims and package-local node_modules/.bin use these native layouts.
  const roots = [
    join(directory, "node_modules", packageName),
    join(directory, "..", packageName),
    join(directory, "node_modules", "corepack"),
  ];
  for (const root of roots) {
    const manifest = join(root, "package.json");
    if (!existsSync(manifest)) continue;
    const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    if (!value || typeof value !== "object" || !("bin" in value)) continue;
    const bins = value.bin;
    const entry =
      typeof bins === "string"
        ? bins
        : bins && typeof bins === "object" && name in bins
          ? Reflect.get(bins, name)
          : undefined;
    if (typeof entry !== "string") continue;
    const script = resolve(root, entry);
    if (existsSync(script) && statSync(script).isFile()) return script;
  }
  return undefined;
}

/** Resolve documented interpreter shims, never evaluate Worker/server argv as shell source. */
export function windowsCommand(
  command: Command,
  allowBuildScript = false,
): Command & { windowsVerbatimArguments?: true } {
  if (process.platform !== "win32") return command;
  if ([command.executable, command.cwd, ...command.args].some((value) => value.includes("\0")))
    throw new Error("Windows executable paths and arguments cannot contain NUL.");
  const environment = commandEnvironment(command);
  const executable = executablePath(command.executable, command.cwd, environment);
  if (!/\.(cmd|bat)$/i.test(executable)) return { ...command, executable };
  const script = nodeShim(executable);
  if (script) return { ...command, executable: process.execPath, args: [script, ...command.args] };
  const name = basename(executable)
    .replace(/\.(cmd|bat)$/i, "")
    .toLowerCase();
  if (name === "bundle" || name === "bundler") {
    const rubyScript = executable.replace(/\.(cmd|bat)$/i, "");
    if (existsSync(rubyScript) && /^#!.*ruby/m.test(readFileSync(rubyScript, "utf8")))
      return {
        ...command,
        executable: executablePath("ruby", command.cwd, environment),
        args: [rubyScript, ...command.args],
      };
  }
  if (name === "composer") {
    const phar = join(dirname(executable), "composer.phar");
    if (existsSync(phar))
      return {
        ...command,
        executable: executablePath("php", command.cwd, environment),
        args: [phar, ...command.args],
      };
  }
  if (allowBuildScript) {
    const parts = [executable, ...command.args];
    if (parts.some((part) => /["\r\n]/.test(part)))
      throw new Error(
        `Native batch build arguments cannot contain quotes or newlines: ${executable}`,
      );
    return {
      ...command,
      executable: executablePath(
        environmentValue(environment, "ComSpec") ?? "cmd.exe",
        command.cwd,
        environment,
      ),
      windowsVerbatimArguments: true,
      args: ["/d", "/s", "/v:off", "/c", `"${parts.map((part) => `"${part}"`).join(" ")}"`],
    };
  }
  throw new Error(
    `Cannot launch batch executable ${executable} with unchanged arguments. Use its native executable or interpreter and script entrypoint; arbitrary .cmd/.bat Worker overrides require shell evaluation.`,
  );
}

/** CRT/libuv command-line quoting, including empty arguments and trailing backslashes. */
export function windowsCommandLine(command: Command): string {
  return [command.executable, ...command.args]
    .map((value) => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`)
    .join(" ");
}
