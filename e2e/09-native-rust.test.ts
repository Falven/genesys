import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/rust/", import.meta.url));
const workerName = "genesys-rust-native";
const activities = "src/temporal/activities/mod.rs";
const workflows = "src/temporal/workflows/mod.rs";
const manual = "src/temporal/workflows/manual.rs";
const nexus = "src/temporal/nexus/caller.rs";
const featureProbe = "src/bin/feature_probe.rs";
const buildMarker = "native-build-ran";
const workerQueue = "rust-native-e2e";

function readLaunchManifest(contents: string) {
  const manifest: unknown = JSON.parse(contents);
  assert(manifest && typeof manifest === "object");
  assert("id" in manifest && typeof manifest.id === "string");
  assert("root" in manifest && typeof manifest.root === "string");
  assert("artifacts" in manifest && Array.isArray(manifest.artifacts));
  assert("workers" in manifest && Array.isArray(manifest.workers));
  const entries: unknown[] = manifest.artifacts;
  const artifacts = entries.map((entry) => {
    assert(entry && typeof entry === "object");
    assert("kind" in entry && typeof entry.kind === "string");
    assert("path" in entry && typeof entry.path === "string");
    return { kind: entry.kind, path: entry.path };
  });
  const workers: unknown[] = manifest.workers;
  return { id: manifest.id, root: manifest.root, artifacts, workers };
}

function startCommand(build: ReturnType<typeof readLaunchManifest>, name: string) {
  const worker = build.workers.find(
    (entry) => entry && typeof entry === "object" && "name" in entry && entry.name === name,
  );
  assert(worker && typeof worker === "object" && "start" in worker);
  const { start } = worker;
  assert(start && typeof start === "object", `Missing the Cargo startup plan for ${name}`);
  assert("executable" in start && typeof start.executable === "string");
  assert("cwd" in start && typeof start.cwd === "string");
  assert("args" in start && Array.isArray(start.args));
  const args: unknown[] = start.args;
  assert(args.every((arg) => typeof arg === "string"));
  let env: Record<string, string> | undefined;
  if ("env" in start && start.env !== undefined) {
    assert(start.env && typeof start.env === "object" && !Array.isArray(start.env));
    env = Object.fromEntries(
      Object.entries(start.env).map(([key, value]: [string, unknown]) => {
        assert(typeof value === "string");
        return [key, value];
      }),
    );
  }
  const command = { executable: start.executable, cwd: start.cwd, args, env };
  const output = build.artifacts.find(
    ({ kind, path }) => kind === "native-output" && path.endsWith(`/target/debug/${name}`),
  );
  if (!output) throw new Error(`Published build is missing the Cargo binary for ${name}`);
  expect(command).toMatchObject({ executable: join(build.root, output.path), cwd: build.root });
  expect(command.args).toEqual([]);
  return command;
}

test("Rust inspection keeps Cargo scope, identities, and diagnostics without running build.rs", async () => {
  await withFixture(
    [
      ["cargo", "--version"],
      ["rustc", "--version"],
    ],
    async (fixture) => {
      await cp(source, fixture.project, { recursive: true });
      const projectFile = (path: string) => join(fixture.project, path);
      const env = { TMPDIR: fixture.root };
      const workflowSource = await readFile(projectFile(workflows), "utf8");
      const independent = "src/temporal/workflows/independent.rs";
      const independentSource = (await readFile(projectFile(manual), "utf8"))
        .replace("#[cfg(not(test))]\n", "")
        .replaceAll("Manual", "Independent")
        .replace("manual-workflow", "hello-workflow");

      await writeFile(projectFile(workflows), `mod independent;\n${workflowSource}`);
      await writeFile(projectFile(independent), independentSource);
      for (const directory of ["src/temporal/workflows/lib", "tests/temporal/workflows"]) {
        await mkdir(projectFile(directory), { recursive: true });
        await writeFile(projectFile(join(directory, "excluded.rs")), independentSource);
      }

      const inspection = await fixture.gsys(["inspect"], { env });
      expect(inspection.code).toBe(0);
      const inspected: unknown = JSON.parse(inspection.stdout);
      expect(inspected).toMatchObject({
        analysis: "native-analysis",
        packages: [{ id: "rust:.", language: "rust", root: ".", manifests: ["Cargo.toml"] }],
        entries: [
          {
            path: activities,
            role: "activity",
            discoveryRoot: "src/temporal",
            packageId: "rust:.",
          },
          { path: nexus, role: "nexus", discoveryRoot: "src/temporal", packageId: "rust:." },
          {
            path: independent,
            role: "workflow",
            discoveryRoot: "src/temporal",
            packageId: "rust:.",
          },
          { path: manual, role: "workflow", discoveryRoot: "src/temporal", packageId: "rust:." },
          { path: workflows, role: "workflow", discoveryRoot: "src/temporal", packageId: "rust:." },
        ],
        definitions: [
          {
            kind: "activity",
            source: { path: activities },
            symbol: "temporal::activities::Operations::greet",
            identity: { name: "greeting", state: "resolved" },
            construction: { symbol: "Operations" },
          },
          {
            kind: "activity",
            source: { path: activities },
            symbol: "temporal::activities::Operations::increment",
            identity: { name: "Operations::increment", state: "resolved" },
            construction: { symbol: "Operations" },
          },
          {
            kind: "workflow",
            source: { path: independent },
            identity: { name: "hello-workflow", state: "resolved" },
          },
          {
            kind: "workflow",
            source: { path: manual },
            identity: { name: "manual-workflow", state: "resolved" },
          },
          {
            kind: "workflow",
            source: { path: workflows },
            symbol: "temporal::workflows::WithFactory",
            identity: { name: "WithFactory", state: "resolved" },
            construction: { symbol: "WithFactory" },
          },
          {
            kind: "workflow",
            source: { path: workflows },
            symbol: "temporal::workflows::Greeting",
            identity: { name: "hello-workflow", state: "resolved" },
          },
        ],
        workers: [
          { name: workerName, language: "rust", source: { path: "src/main.rs" } },
          { name: "feature-probe", language: "rust", source: { path: featureProbe } },
        ],
      });
      expect(inspection.stderr).not.toContain("rust.generated-scope-collision");
      expect(inspection.stderr).toContain(`warning rust.assembly-required ${manual}:`);
      expect(inspection.stderr).toContain(`warning rust.nexus-handler-unsupported ${nexus}:`);
      await expect(readFile(projectFile(buildMarker))).rejects.toMatchObject({ code: "ENOENT" });

      const shadow = "shadow/src/temporal/workers";
      await mkdir(projectFile(shadow), { recursive: true });
      await writeFile(
        projectFile("shadow/Cargo.toml"),
        `[package]
name = "${workerName}"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "${workerName}"
path = "src/temporal/workers/main.rs"
`,
      );
      await writeFile(projectFile(`${shadow}/main.rs`), "fn main() {}\n");
      const collision = independentSource
        .replaceAll("Independent", "Collision")
        .replace(/^(use .*;\n)+/, "")
        .replace("#[workflow_methods]", "#[native_workflow_methods]");
      await writeFile(
        projectFile(workflows),
        `${workflowSource}
${collision}
#[workflow]
struct Invalid;

#[native_workflow_methods]
impl Invalid {}

#[workflow]
#[derive(Default)]
struct Unresolved;

#[native_workflow_methods]
impl Unresolved {
    #[run(name = concat!("un", "resolved"))]
    async fn run(_ctx: &mut WorkflowContext<Self>) -> WorkflowResult<()> { Ok(()) }
}
`,
      );
      await rm(projectFile(independent));
      const invalid = await fixture.gsys(["inspect"], { env });
      expect(invalid.code).toBe(1);
      const invalidReport: unknown = JSON.parse(invalid.stdout);
      expect(invalidReport).toMatchObject({
        definitions: expect.arrayContaining([
          expect.objectContaining({
            symbol: "temporal::workflows::Unresolved",
            identity: { state: "unresolved", reason: expect.any(String) },
          }),
        ]),
        workers: expect.arrayContaining([
          expect.objectContaining({ name: workerName, source: { path: "src/main.rs" } }),
          expect.objectContaining({ name: workerName, source: { path: `${shadow}/main.rs` } }),
        ]),
      });
      const diagnostics: unknown = JSON.parse(
        await readFile(projectFile(".gsys/discovery/diagnostics.json"), "utf8"),
      );
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "rust.generated-scope-collision",
            severity: "warning",
            message: expect.stringContaining('"hello-workflow"'),
            source: { path: workflows, line: expect.any(Number) },
            related: [{ path: workflows, line: expect.any(Number) }],
          }),
          expect.objectContaining({ code: "rust.name-unresolved", severity: "warning" }),
          expect.objectContaining({ code: "rust.workflow-run", severity: "error" }),
          expect.objectContaining({
            code: "worker.ambiguous-name",
            severity: "error",
            source: { path: `${shadow}/main.rs` },
            related: [{ path: "src/main.rs" }],
          }),
        ]),
      );
      await expect(readFile(projectFile(buildMarker))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
}, 360_000);

test("published Rust registration runs private Workflows, shared Activities, and authored options", async () => {
  await withFixture(
    [
      ["cargo", "--version"],
      ["rustc", "--version"],
      [process.env.PROTOC ?? "protoc", "--version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await cp(source, fixture.project, { recursive: true });
      const projectFile = (path: string) => join(fixture.project, path);
      const env = { TMPDIR: fixture.root };

      async function build() {
        const result = await fixture.gsys(["build"], { env, timeout: 360_000 });
        expect(result.code).toBe(0);
        const published: unknown = JSON.parse(result.stdout);
        assert(published && typeof published === "object" && "id" in published);
        assert(typeof published.id === "string");
        const version = join(await realpath(fixture.project), ".gsys/compile/builds", published.id);
        const root = join(version, "project");
        const manifestPath = join(version, "manifest.json");
        expect(published).toMatchObject({
          schemaVersion: 1,
          root,
          manifestPath,
          inputs: expect.arrayContaining([
            expect.objectContaining({ path: "Cargo.lock", kind: "file" }),
            expect.objectContaining({ path: "src/options.rs", kind: "file" }),
          ]),
          artifacts: expect.arrayContaining([
            expect.objectContaining({ kind: "registration" }),
            expect.objectContaining({ path: buildMarker, kind: "native-output" }),
          ]),
        });
        await expect(readFile(join(root, buildMarker), "utf8")).resolves.toBe(
          "Cargo executed build.rs",
        );
        const selected: unknown = JSON.parse(
          await readFile(projectFile(".gsys/compile/manifest.json"), "utf8"),
        );
        expect(selected).toMatchObject({ id: published.id, manifestPath });
        const manifest = readLaunchManifest(await readFile(manifestPath, "utf8"));
        expect(manifest).toMatchObject({ id: published.id, root });
        return manifest;
      }

      const original = await build();
      const originalSource = await readFile(join(source, workflows), "utf8");
      await expect(readFile(projectFile(workflows), "utf8")).resolves.toBe(originalSource);
      const moved = "src/temporal/workflows/explicit.rs";
      await rename(projectFile(manual), projectFile(moved));
      const replacementSource = originalSource
        .replace("mod manual;", '#[path = "explicit.rs"]\nmod manual;')
        .replaceAll("Greeting", "Replacement")
        .replace('"hello-workflow"', '"replacement-workflow"')
        .replace('"before"', '"after"');
      await writeFile(projectFile(workflows), replacementSource);
      const replacement = await build();
      expect(replacement.id).not.toBe(original.id);
      await expect(readFile(projectFile(workflows), "utf8")).resolves.toBe(replacementSource);
      await expect(readFile(join(original.root, workflows), "utf8")).resolves.toBe(originalSource);
      const updated: unknown = JSON.parse(
        await readFile(join(replacement.root, ".gsys/discovery/manifest.json"), "utf8"),
      );
      expect(updated).toMatchObject({
        definitions: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ path: moved }),
            symbol: "temporal::workflows::manual::Manual",
            identity: { name: "manual-workflow", state: "resolved" },
          }),
        ]),
      });
      const generated = await Promise.all(
        replacement.artifacts
          .filter(({ kind }) => kind === "registration")
          .map(({ path }) => readFile(join(replacement.root, path), "utf8")),
      );
      expect(generated).toHaveLength(2);
      expect(generated.join("\n")).toContain("register_workflow::<Replacement>()");
      expect(generated.join("\n")).not.toContain("register_workflow::<Greeting>()");
      expect(generated.join("\n")).not.toContain("register_workflow::<Manual>()");

      const probe = startCommand(original, "feature-probe");
      const feature = await fixture.run(probe.executable, probe.args, {
        cwd: probe.cwd,
        env: { ...env, ...probe.env },
      });
      expect(feature).toMatchObject({ code: 0, stdout: "Cargo feature probe enabled\n" });

      const endpoint = await temporalEndpoint();
      fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs], { env });
      const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
      try {
        await connection.ensureConnected();
        const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
        const workflowOptions = () => ({
          taskQueue: workerQueue,
          workflowId: randomUUID(),
          workflowExecutionTimeout: 35_000,
        });
        for (const [published, identity, result] of [
          [original, "hello-workflow", "before"],
          [replacement, "replacement-workflow", "after"],
        ] as const) {
          const command = startCommand(published, workerName);
          const worker = fixture.start(command.executable, command.args, {
            cwd: command.cwd,
            env: { ...env, ...command.env, ...endpoint.workerEnv },
          });
          try {
            await expect(
              connection.withDeadline(Date.now() + 40_000, () =>
                client.execute(identity, workflowOptions()),
              ),
            ).resolves.toBe(result);
            await expect(
              connection.withDeadline(Date.now() + 40_000, () =>
                client.execute("manual-workflow", workflowOptions()),
              ),
            ).resolves.toBe("explicit");
            await connection.withDeadline(Date.now() + 40_000, async () => {
              const workflow = await client.start("WithFactory", workflowOptions());
              await workflow.signal("release", "signaled");
              await expect(workflow.result()).resolves.toBe(
                "instance:factory-intercepted:42:signaled",
              );
            });
            if (published.id === replacement.id) {
              await connection.withDeadline(Date.now() + 20_000, async () => {
                const removed = await client.start("hello-workflow", workflowOptions());
                try {
                  await expect
                    .poll(async () =>
                      (await removed.fetchHistory()).events?.some(
                        (event) =>
                          event.workflowTaskFailedEventAttributes?.failure?.message ===
                          "Workflow type hello-workflow not found",
                      ),
                    )
                    .toBe(true);
                } finally {
                  await removed.terminate();
                }
              });
            }
          } finally {
            await worker.stop();
          }
        }
      } finally {
        await connection.close();
      }
    },
  );
}, 960_000);
