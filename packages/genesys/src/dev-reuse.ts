import { randomUUID } from "node:crypto";
import { open, mkdir, lstat, rename, rm, writeFile } from "node:fs/promises";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { DevEvent, DevSession } from "./dev.js";

const requestTimeout = 1_500;
const eventLimit = 64 * 1024;
const queueLimit = 256 * 1024;
const clientLimit = 16;

function recordPath(projectRoot: string): string {
  return join(projectRoot, ".gsys", "dev", "supervisor.json");
}

async function recordedPort(projectRoot: string): Promise<number | undefined> {
  const path = recordPath(projectRoot);
  const file = await open(path, "r").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error(`Cannot read supervisor endpoint record ${path}.`, { cause: error });
  });
  if (!file) return undefined;
  let content: string;
  try {
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer);
    content = buffer.toString("utf8", 0, bytesRead);
  } catch (error) {
    throw new Error(`Cannot read supervisor endpoint record ${path}.`, { cause: error });
  } finally {
    await file.close();
  }
  try {
    if (Buffer.byteLength(content) > 4096) throw new Error("Endpoint record exceeds 4096 bytes.");
    const record: unknown = JSON.parse(content);
    if (
      !record ||
      typeof record !== "object" ||
      !("url" in record) ||
      typeof record.url !== "string"
    )
      throw new Error("Endpoint record must contain a URL.");
    // Restrict edited records to the exact loopback form that this process publishes.
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(record.url))
      throw new Error("Endpoint record must use an IPv4 loopback HTTP URL with only a port.");
    const port = Number(record.url.slice(record.url.lastIndexOf(":") + 1));
    if (port > 65535) throw new Error("Endpoint port is invalid.");
    return port;
  } catch {
    process.stderr.write("[gsys] Ignoring invalid supervisor endpoint record.\n");
    return undefined;
  }
}

function responding(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get({ host: "127.0.0.1", port, path: "/status", agent: false }, (response) => {
      clearTimeout(timer);
      resolve(response.statusCode === 200);
      response.destroy();
      request.destroy();
    });
    const timer = setTimeout(
      () => request.destroy(new Error("Supervisor probe timed out.")),
      requestTimeout,
    );
    request.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function stream(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let response: IncomingMessage | undefined;
    let finished = false;
    let disconnected = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.off("SIGINT", disconnect);
      process.off("SIGTERM", disconnect);
      process.stdout.off("error", finish);
      response?.unpipe(process.stdout);
      response?.destroy();
      request.destroy();
      if (error && !disconnected) reject(error);
      else resolve();
    };
    const disconnect = (): void => {
      disconnected = true;
      finish();
    };
    const request = get({ host: "127.0.0.1", port, path: "/events", agent: false }, (incoming) => {
      response = incoming;
      clearTimeout(timer);
      if (incoming.statusCode !== 200) {
        finish(
          new Error(`Supervisor log stream refused the connection (HTTP ${incoming.statusCode}).`),
        );
        return;
      }
      incoming.on("error", () =>
        finish(
          new Error(
            "Supervisor log stream disconnected before completion; the owner was not stopped.",
          ),
        ),
      );
      incoming.on("end", () => finish());
      // pipe pauses the response while stdout is full; the owner bounds its own queue.
      incoming.pipe(process.stdout, { end: false });
    });
    const timer = setTimeout(
      () => finish(new Error("Supervisor log stream did not respond.")),
      requestTimeout,
    );
    request.on("error", () =>
      finish(new Error("Cannot read supervisor log stream; the owner was not stopped.")),
    );
    process.on("SIGINT", disconnect);
    process.on("SIGTERM", disconnect);
    process.stdout.on("error", finish);
  });
}

export async function tryReuseSupervisor(
  projectRoot: string,
  startupConfigured: boolean,
): Promise<boolean> {
  const port = await recordedPort(projectRoot);
  if (port === undefined || !(await responding(port))) return false;
  if (startupConfigured)
    throw new Error(
      "A supervisor is already responding. Startup options cannot reconfigure a reused session, even with matching values. Run gsys dev without startup options to reuse it.",
    );
  process.stdout.write(
    "[gsys] Reusing the existing supervisor. Interrupt to disconnect; the owner remains running.\n",
  );
  await stream(port);
  return true;
}

function plain(event: DevEvent): string {
  let content = "";
  let bytes = 0;
  let truncated = event.message.length > eventLimit;
  const lines = event.message.slice(0, eventLimit).split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const output = `[${event.label.slice(0, 512)}] ${line}\n`;
    if (bytes + Buffer.byteLength(output) > eventLimit) {
      content += Buffer.from(output)
        .subarray(0, eventLimit - bytes)
        .toString("utf8");
      truncated = true;
      break;
    }
    content += output;
    bytes += Buffer.byteLength(output);
  }
  return `${content}${truncated ? "\n[gsys] Log event truncated for secondary clients.\n" : ""}`;
}

export async function startSupervisor(session: DevSession): Promise<{ close(): Promise<void> }> {
  const clients = new Set<ServerResponse>();
  const write = (client: ServerResponse, content: string): void => {
    if (client.destroyed) return;
    if (client.writableLength + Buffer.byteLength(content) > queueLimit) {
      clients.delete(client);
      client.destroy();
      session.report({
        kind: "status",
        label: "gsys",
        message: "Disconnected a slow supervisor log client; its output queue exceeded 256 KiB.",
      });
      return;
    }
    client.write(content);
  };
  const status = (): string => {
    let content = `[gsys] Supervisor listening; Worker readiness is reported separately.\n[temporal] ${session.temporal.state}\n`;
    for (const worker of session.workers) {
      const line = plain({
        kind: "status",
        label: worker.process.label,
        message: `${worker.process.state}; ${worker.observation.readiness}: ${worker.observation.reason}`,
      });
      if (Buffer.byteLength(content) + Buffer.byteLength(line) > eventLimit) {
        content += "[gsys] Status snapshot truncated; live status continues.\n";
        break;
      }
      content += line;
    }
    return content;
  };
  const server = createServer(
    { requestTimeout: 5_000, headersTimeout: 5_000 },
    (request, response) => {
      response.on("error", () => response.destroy());
      if (
        request.method !== "GET" ||
        request.headers.origin ||
        request.headers.host !== `127.0.0.1:${port}`
      ) {
        response.writeHead(403).end();
        return;
      }
      if (request.url !== "/status" && request.url !== "/events") {
        response.writeHead(404).end();
        return;
      }
      if (request.url === "/events" && clients.size >= clientLimit) {
        response.writeHead(503).end("[gsys] Supervisor log client limit reached.\n");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.url === "/status") {
        response.end(status());
        return;
      }
      clients.add(response);
      response.on("close", () => clients.delete(response));
      write(response, status());
    },
  );
  server.maxConnections = 32;
  let port: number;
  const unsubscribe = session.onEvent((event) => {
    const content = plain(event);
    for (const client of clients) write(client, content);
  });
  const close = async (): Promise<void> => {
    unsubscribe();
    const stopped = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    server.closeAllConnections();
    await stopped;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Supervisor has no loopback address.");
    port = address.port;
    server.on("error", (error) =>
      session.report({
        kind: "error",
        label: "gsys",
        message: `Supervisor endpoint failed: ${error.message}`,
      }),
    );
    for (const path of [
      join(session.projectRoot, ".gsys"),
      join(session.projectRoot, ".gsys", "dev"),
    ]) {
      await mkdir(path, { recursive: true });
      if (!(await lstat(path)).isDirectory())
        throw new Error(`Supervisor record directory must not be a symlink: ${path}`);
    }
    const path = recordPath(session.projectRoot);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ url: `http://127.0.0.1:${port}` })}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    // Leave the last-ready record in place: it is advisory, including after owner shutdown.
    return { close };
  } catch (error) {
    unsubscribe();
    if (server.listening) await close();
    throw error;
  }
}
