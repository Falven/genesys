import { execFile } from "node:child_process";

interface ToolInvocation {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeout: number;
  maxBuffer: number;
}

export function runTool(invocation: ToolInvocation): Promise<string> {
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    const child = execFile(
      invocation.executable,
      invocation.args,
      {
        cwd: invocation.cwd,
        env: invocation.env,
        timeout: invocation.timeout,
        maxBuffer: invocation.maxBuffer,
        encoding: "utf8",
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`${invocation.executable} failed: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
        } else if (inputError) {
          reject(inputError);
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.on("error", (error: Error) => {
      inputError = error;
    });
    child.stdin?.end(invocation.input);
  });
}
