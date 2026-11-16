import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { posixTest as test, temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const runtimeImage = "alpine:3.22";
const temporalImage = "temporalio/temporal:1.10.0";
const taskQueue = "greetings";
const activityPath = "temporal/activities/greeting.go";
const deploymentFile = "deployment-version.txt";

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function runAndStop({ stop }: ReturnType<Fixture["start"]>, run: () => Promise<void>) {
  const failures: unknown[] = [];
  await run().catch((error: unknown) => failures.push(error));
  await stop().catch((error: unknown) => failures.push(error));
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "Deployment operation and shutdown failed");
}

async function copyExample(project: string) {
  await mkdir(project, { recursive: true });
  for (const path of ["go.mod", "go.sum", "temporal"])
    await cp(join(example, path), join(project, path), { recursive: true });

  await writeFile(join(project, deploymentFile), "published");
  await writeFile(
    join(project, activityPath),
    `package activities

import (
  "context"
  "os"
)

func Greet(_ context.Context, name string) (string, error) {
  version, err := os.ReadFile(${JSON.stringify(deploymentFile)})
  return "Hello, " + name + "! " + string(version), err
}
`,
  );
}

async function editAuthoredProject(project: string) {
  const activity = join(project, activityPath);
  await writeFile(activity, (await readFile(activity, "utf8")).replace("Hello, ", "Changed, "));
  await writeFile(join(project, deploymentFile), "edited source");
}

async function readBuild(project: string) {
  const compile = join(project, ".gsys", "compile");
  const selector = join(compile, "manifest.json");
  const selected: unknown = JSON.parse(await readFile(selector, "utf8"));
  assert(selected && typeof selected === "object" && "id" in selected);
  assert(typeof selected.id === "string");
  const version = join(compile, "builds", selected.id);
  const manifestPath = join(version, "manifest.json");
  expect(selected).toMatchObject({
    projectRoot: project,
    manifestPath,
    root: join(version, "project"),
  });

  const contents = await readFile(manifestPath, "utf8");
  const manifest: unknown = JSON.parse(contents);
  expect(manifest).toMatchObject(selected);
  assert(manifest && typeof manifest === "object" && "workers" in manifest);
  assert(Array.isArray(manifest.workers));
  expect(manifest.workers).toHaveLength(1);
  const worker: unknown = manifest.workers[0];
  assert(worker && typeof worker === "object" && "start" in worker);
  expect(worker).toMatchObject({ name: "greeting", language: "go" });
  const { start } = worker;
  assert(
    start &&
      typeof start === "object" &&
      "executable" in start &&
      "args" in start &&
      "cwd" in start,
  );
  assert(typeof start.executable === "string" && typeof start.cwd === "string");
  assert(Array.isArray(start.args) && start.args.every((arg: unknown) => typeof arg === "string"));
  expect(start.cwd).toBe(join(version, "project"));
  expect(start.executable.startsWith(join(start.cwd, ".gsys", "native") + "/")).toBe(true);
  expect(start).not.toHaveProperty("env");
  return {
    executable: start.executable,
    args: start.args,
    cwd: start.cwd,
    manifestPath,
    version,
    contents,
  };
}

async function executeGreeting(address: string, namespace: string, name: string) {
  const connection = Connection.lazy({ address, connectTimeout: "30s" });
  try {
    await connection.ensureConnected();
    const client = new WorkflowClient({ connection, namespace });
    await expect(
      connection.withDeadline(Date.now() + 45_000, () =>
        client.execute("Greeting", {
          taskQueue,
          workflowId: randomUUID(),
          args: [name],
          workflowExecutionTimeout: "40s",
        }),
      ),
    ).resolves.toBe(`Hello, ${name}! published`);
  } finally {
    await connection.close();
  }
}

async function runHostWorker(
  fixture: Fixture,
  build: Awaited<ReturnType<typeof readBuild>>,
  address: string,
  namespace: string,
  name: string,
) {
  const worker = fixture.start(build.executable, build.args, {
    cwd: build.cwd,
    env: { TEMPORAL_ADDRESS: address, TEMPORAL_NAMESPACE: namespace },
  });
  await runAndStop(worker, () => executeGreeting(address, namespace, name));
  expect(await worker.wait()).toMatchObject({ code: 0, signal: null });
}

async function digest(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

test("published Go builds keep their launch files and settings across direct, hybrid, and read-only Compose startup", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
      ["docker", "compose", "version"],
    ],
    async (fixture) => {
      const root = await realpath(fixture.root);
      const hostProject = join(root, "project");
      const linuxProject = join(root, "linux-project");
      await copyExample(hostProject);
      await copyExample(linuxProject);
      expect(await fixture.gsys(["build"], { env: { CGO_ENABLED: "0" } })).toMatchObject({
        code: 0,
      });
      const hostBuild = await readBuild(hostProject);
      const hostEndpoint = await temporalEndpoint();
      const server = fixture.start("temporal", ["server", "start-dev", ...hostEndpoint.serverArgs]);
      await runAndStop(server, async () => {
        const connection = Connection.lazy({
          address: hostEndpoint.address,
          connectTimeout: "30s",
        });
        try {
          await connection.ensureConnected();
          await runHostWorker(
            fixture,
            hostBuild,
            hostEndpoint.address,
            hostEndpoint.namespace,
            "direct",
          );
        } finally {
          await connection.close();
        }
      });
      await editAuthoredProject(hostProject);

      async function docker(args: readonly string[], timeout?: number) {
        const result = await fixture.run("docker", args, { timeout });
        expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
        return result.stdout.trim();
      }

      const platform = await docker(["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]);
      assert(
        platform === "linux/amd64" || platform === "linux/arm64",
        `A Linux Docker engine is required, got ${platform}`,
      );
      const uid = process.getuid?.();
      const gid = process.getgid?.();
      assert(uid !== undefined && gid !== undefined, "A macOS or Linux host is required");
      const composeProject = `gsys21-${randomUUID()}`;
      const composeFile = join(root, "compose.json");
      const directContainer = `${composeProject}-direct`;
      const containerEnv = { TEMPORAL_ADDRESS: "temporal:7233", TEMPORAL_NAMESPACE: "default" };
      const services = {
        temporal: {
          image: temporalImage,
          platform,
          command: ["server", "start-dev", "--ip", "0.0.0.0", "--headless"],
          ports: ["127.0.0.1::7233"],
          healthcheck: {
            test: [
              "CMD",
              "temporal",
              "operator",
              "cluster",
              "health",
              "--address",
              "127.0.0.1:7233",
            ],
            interval: "1s",
            timeout: "3s",
            retries: 30,
          },
        },
        builder: {
          platform,
          profiles: ["tooling"],
          build: {
            context: "./builder",
            dockerfile_inline: `FROM golang:1.27.4-bookworm AS go
FROM node:26.13.1-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH
`,
          },
          volumes: [{ type: "bind", source: root, target: root }],
          working_dir: linuxProject,
          user: `${uid}:${gid}`,
          environment: { HOME: join(root, "linux-home"), CGO_ENABLED: "0" },
        },
      };
      const compose = (args: readonly string[], timeout?: number) =>
        docker(
          ["compose", "--project-name", composeProject, "--file", composeFile, ...args],
          timeout,
        );
      await mkdir(join(root, "builder"));
      await mkdir(services.builder.environment.HOME);
      await writeFile(composeFile, JSON.stringify({ services }));

      const failures: unknown[] = [];
      try {
        await compose(["up", "--detach", "--wait", "temporal"]);
        const address = await compose(["port", "temporal", "7233"]);
        expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
        await runHostWorker(fixture, hostBuild, address, "default", "hybrid");

        const linuxConsumer = join(root, "linux-consumer");
        await mkdir(linuxConsumer);
        await writeFile(join(linuxConsumer, "package.json"), '{"private":true}\n');
        await compose(["build", "builder"], 300_000);
        await compose(
          [
            "run",
            "--no-deps",
            "--rm",
            "-T",
            "builder",
            "sh",
            "-ceu",
            `cd "$1"
node --version
npm --version
go version
npm install --no-audit --no-fund --no-save --package-lock=false "$2"
node_modules/.bin/gsys --version
node_modules/.bin/gsys build "$3"`,
            "linux-build",
            linuxConsumer,
            join(root, basename(fixture.tarball)),
            linuxProject,
          ],
          300_000,
        );
        const build = await readBuild(linuxProject);
        const hash = await digest(build.executable);
        const worker = {
          image: runtimeImage,
          platform,
          user: "65532:65532",
          entrypoint: [build.executable],
          command: build.args,
          working_dir: build.cwd,
          environment: containerEnv,
          volumes: [
            { type: "bind", source: build.version, target: build.version, read_only: true },
          ],
          depends_on: { temporal: { condition: "service_healthy" } },
          stop_grace_period: "45s",
        };

        const direct = fixture.start("docker", [
          "run",
          "--rm",
          "--name",
          directContainer,
          "--platform",
          platform,
          "--network",
          `${composeProject}_default`,
          "--user",
          worker.user,
          "--mount",
          `type=bind,source=${build.version},target=${build.version}`,
          "--workdir",
          worker.working_dir,
          "--entrypoint",
          build.executable,
          ...Object.entries(containerEnv).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
          runtimeImage,
          ...build.args,
        ]);
        await runAndStop(direct, () => executeGreeting(address, "default", "Linux direct"));
        expect(await direct.wait()).toMatchObject({ code: 0, signal: null });

        await editAuthoredProject(linuxProject);
        await writeFile(
          composeFile,
          JSON.stringify({ services: { ...services, greeting: worker } }),
        );
        await compose(["up", "--detach", "greeting"]);
        const container = await compose(["ps", "--quiet", "greeting"]);
        expect(container).not.toBe("");
        const inspection: unknown = JSON.parse(await docker(["container", "inspect", container]));
        expect(inspection).toMatchObject([
          {
            Path: build.executable,
            Args: build.args,
            Config: { WorkingDir: build.cwd },
            Mounts: [
              { Source: build.version, Destination: build.version, RW: false, Type: "bind" },
            ],
          },
        ]);
        await executeGreeting(address, "default", "Compose");
        expect(await readFile(build.manifestPath, "utf8")).toBe(build.contents);
        expect(await digest(build.executable)).toBe(hash);
        await compose(["stop", "greeting"]);
        expect(await docker(["inspect", "--format", "{{.State.ExitCode}}", container])).toBe("0");
      } catch (error) {
        failures.push(error);
        await compose(["logs", "--no-color"]).catch((error: unknown) => failures.push(error));
        try {
          const remaining = await docker([
            "container",
            "ls",
            "--all",
            "--quiet",
            "--filter",
            `name=^/${directContainer}$`,
          ]);
          if (remaining) await docker(["container", "rm", "--force", remaining]);
        } catch (cleanupError) {
          failures.push(cleanupError);
        }
      } finally {
        await compose(["--profile", "tooling", "down", "--rmi", "local", "--remove-orphans"]).catch(
          (error: unknown) => failures.push(error),
        );
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "Deployment case and cleanup failed");
    },
  );
}, 720_000);
