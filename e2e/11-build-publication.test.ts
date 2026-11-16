import { Connection, WorkflowClient } from "@temporalio/client";
import assert from "node:assert/strict";
import { hash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("../examples/native-workers/", import.meta.url));
const activity = "temporal/activities/greeting.go";
const launcher = "temporal/workers/greeting/main.go";
const activityRegistration = "temporal/activities/zz_genesys_registration.go";
const registration = [
  activityRegistration,
  "temporal/workflows/zz_genesys_registration.go",
  "temporal/gsysregistration/registration.go",
];
const compilePath = ".gsys/compile";
const secret = `test-secret-${randomUUID()}`;
const buildEnv = { GENESYS_E2E_PUBLICATION_SECRET: secret };
type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

async function copyProject(fixture: Fixture) {
  for (const path of ["go.mod", "go.sum", "temporal"])
    await cp(join(example, path), join(fixture.project, path), { recursive: true });
  return await realpath(fixture.project);
}

function parseManifest(contents: string) {
  const manifest: unknown = JSON.parse(contents);
  assert(manifest && typeof manifest === "object" && "id" in manifest);
  assert(typeof manifest.id === "string");
  expect(manifest.id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  return { id: manifest.id, manifest };
}

async function completeSelection(project: string, contents: string) {
  const { id, manifest } = parseManifest(contents);
  const version = join(project, compilePath, "builds", id);
  const root = join(version, "project");
  const manifestPath = join(version, "manifest.json");
  const metadataPath = join(version, "metadata.json");
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    projectRoot: project,
    root,
    manifestPath,
    metadataPath,
  });
  await expect(readFile(manifestPath, "utf8")).resolves.toBe(contents);

  assert("workers" in manifest && Array.isArray(manifest.workers));
  expect(manifest.workers).toHaveLength(1);
  const worker: unknown = manifest.workers[0];
  assert(worker && typeof worker === "object" && "start" in worker);
  expect(worker).toMatchObject({ name: "greeting", language: "go", source: { path: launcher } });
  const { start } = worker;
  assert(
    start &&
      typeof start === "object" &&
      "executable" in start &&
      "cwd" in start &&
      "args" in start,
  );
  assert(typeof start.executable === "string" && start.cwd === root);
  assert(Array.isArray(start.args) && start.args.every((arg: unknown) => typeof arg === "string"));
  expect(start.args).toEqual([]);
  const binary = relative(root, start.executable).replaceAll("\\", "/");
  expect(binary).toMatch(/^\.gsys\/native\/go\/[^/]+\/greeting(?:\.exe)?$/);
  await access(start.executable, constants.X_OK);

  const metadataText = await readFile(metadataPath, "utf8");
  const metadata: unknown = JSON.parse(metadataText);
  expect(contents).not.toContain(secret);
  expect(metadataText).not.toContain(secret);
  expect(metadata).toMatchObject({
    schemaVersion: 1,
    id,
    platform: process.platform,
    architecture: process.arch,
    environmentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    tools: expect.arrayContaining([
      expect.objectContaining({
        executable: "go",
        cwd: root,
        version: expect.stringMatching(/^go version /),
      }),
    ]),
    commands: expect.arrayContaining([
      expect.objectContaining({
        executable: "go",
        cwd: root,
        args: expect.arrayContaining([
          "build",
          "-o",
          start.executable,
          "./temporal/workers/greeting",
        ]),
      }),
    ]),
    generatorInputs: expect.arrayContaining([
      expect.objectContaining({
        path: "package.json",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]),
  });
  expect(metadata).toMatchObject({
    inputs: expect.arrayContaining([
      expect.objectContaining({
        path: activity,
        sha256: hash("sha256", await readFile(join(root, activity))),
      }),
    ]),
  });

  const outputs = [
    ...registration.map((path) => ({ path, kind: "registration" })),
    { path: binary, kind: "native-output" },
  ];
  for (const { path, kind } of outputs) {
    const bytes = await readFile(join(root, path));
    const sha256 = hash("sha256", bytes);
    expect(manifest).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          path,
          kind,
          entry: expect.objectContaining({ path, kind: "file", size: bytes.length, sha256 }),
        }),
      ]),
    });
    if (kind === "registration")
      expect(metadata).toMatchObject({
        generation: expect.arrayContaining([expect.objectContaining({ path, kind, sha256 })]),
      });
  }
  return { manifestPath, executable: start.executable, cwd: start.cwd, args: start.args };
}

test("failed candidates leave the previous complete build selected and runnable", async () => {
  await withFixture(
    [
      ["go", "version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      const project = await copyProject(fixture);
      const compile = join(project, compilePath);
      const selector = join(compile, "manifest.json");
      const builds = join(compile, "builds");
      const activityFile = join(project, activity);
      const launcherFile = join(project, launcher);
      const authoredActivity = await readFile(activityFile, "utf8");
      const authoredLauncher = await readFile(launcherFile, "utf8");

      // Keep a prior successful build so candidate cleanup cannot sweep other builds.
      const olderBuild = await fixture.gsys(["build"], { env: buildEnv });
      expect(olderBuild.code).toBe(0);
      const older = await readFile(selector, "utf8");
      const retained = await completeSelection(project, older);
      const success = await fixture.gsys(["build"], { env: buildEnv });
      expect(success.code).toBe(0);
      const selected = await readFile(selector, "utf8");
      expect(selected).not.toBe(older);
      const versions = (await readdir(builds)).sort();
      const compileEntries = (await readdir(compile)).sort();
      expect(versions).toEqual([parseManifest(older).id, parseManifest(selected).id].sort());
      const changedActivity = authoredActivity.replace("Hello, ", "Candidate, ");
      expect(changedActivity).not.toBe(authoredActivity);

      async function rejectsCandidate(diagnostic: RegExp) {
        const result = await fixture.gsys(["build"], { env: buildEnv });
        expect(result).toMatchObject({
          code: 1,
          signal: null,
          stderr: expect.stringMatching(diagnostic),
        });
        await expect(readFile(selector, "utf8")).resolves.toBe(selected);
        await expect(readFile(retained.manifestPath, "utf8")).resolves.toBe(older);
        expect((await readdir(builds)).sort()).toEqual(versions);
        expect((await readdir(compile)).sort()).toEqual(compileEntries);
      }

      const invalidActivity = authoredActivity.replace(
        '"Hello, " + name + "!"',
        "missingForAnalysis",
      );
      await writeFile(activityFile, invalidActivity);
      await rejectsCandidate(/error go\.package-diagnostic[^\n]*undefined: missingForAnalysis/);
      await expect(readFile(activityFile, "utf8")).resolves.toBe(invalidActivity);
      await writeFile(activityFile, changedActivity);

      const authoredRegistration = join(project, activityRegistration);
      const localRegistration = "package activities\n\nconst localRegistration = true\n";
      await writeFile(authoredRegistration, localRegistration, { flag: "wx" });
      await rejectsCandidate(
        /Refusing to overwrite authored file: temporal\/activities\/zz_genesys_registration\.go/,
      );
      await expect(readFile(authoredRegistration, "utf8")).resolves.toBe(localRegistration);
      await rm(authoredRegistration);

      const invalidLauncher = authoredLauncher.replace(
        "gsysregistration.Register(w)",
        "gsysregistration.Missing(w)",
      );
      await writeFile(launcherFile, invalidLauncher);
      await rejectsCandidate(/undefined: gsysregistration\.Missing[\s\S]*gsys: go failed \(1\)/);
      await expect(readFile(launcherFile, "utf8")).resolves.toBe(invalidLauncher);
      await writeFile(launcherFile, authoredLauncher);

      // A directory at the convenience metadata path makes the real publication rename fail.
      const pointer = join(compile, "metadata.json");
      const savedPointer = join(fixture.root, "saved-metadata.json");
      await rename(pointer, savedPointer);
      await mkdir(pointer);
      const sentinel = join(pointer, "keep.txt");
      await writeFile(sentinel, "keep");
      await rejectsCandidate(
        /(?:EISDIR|ENOTDIR|EEXIST|EPERM).*rename.*\.metadata-.*metadata\.json/,
      );
      await expect(readFile(sentinel, "utf8")).resolves.toBe("keep");
      await rm(pointer, { recursive: true });
      await rename(savedPointer, pointer);

      await expect(readFile(activityFile, "utf8")).resolves.toBe(changedActivity);
      await expect(readFile(launcherFile, "utf8")).resolves.toBe(authoredLauncher);
      for (const path of registration)
        await expect(access(join(project, path))).rejects.toMatchObject({ code: "ENOENT" });
      const immutable = await completeSelection(project, await readFile(selector, "utf8"));
      await completeSelection(project, older);

      // Launch the command in the selected immutable manifest after the last build failed.
      const endpoint = await temporalEndpoint();
      fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
      const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
      try {
        await connection.ensureConnected();
        await expect
          .poll(
            () =>
              connection.withDeadline(Date.now() + 5_000, () =>
                connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
              ),
            { timeout: 10_000 },
          )
          .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
        const worker = fixture.start(immutable.executable, immutable.args, {
          cwd: immutable.cwd,
          env: endpoint.workerEnv,
        });
        const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
        const result = await connection.withDeadline(Date.now() + 45_000, () =>
          client.execute("Greeting", {
            taskQueue: "greetings",
            workflowId: randomUUID(),
            args: ["Genesys"],
            workflowExecutionTimeout: "40s",
          }),
        );
        expect(result).toBe("Hello, Genesys!");
        worker.signal("SIGINT");
        expect(await worker.wait(45_000)).toMatchObject({ code: 0, signal: null });
      } finally {
        await connection.close();
      }
    },
  );
}, 720_000);

test("concurrent builds select only complete immutable manifests", async () => {
  await withFixture([["go", "version"]], async (fixture) => {
    const project = await copyProject(fixture);
    const compile = join(project, compilePath);
    const selector = join(compile, "manifest.json");
    const builds = join(compile, "builds");
    expect((await fixture.gsys(["build"], { env: buildEnv })).code).toBe(0);
    const initial = await readFile(selector, "utf8");
    await completeSelection(project, initial);

    let active = 2;
    const candidates = [
      fixture.startGsys(["build"], { env: buildEnv }),
      fixture.startGsys(["build"], { env: buildEnv }),
    ];
    const results = Promise.allSettled(
      candidates.map((candidate) =>
        candidate.wait().finally(() => {
          active--;
        }),
      ),
    );
    const observed = new Set([initial]);
    let overlapped = false;
    while (active) {
      const ids = await readdir(builds);
      if (active === 2 && ids.length === 3) overlapped = true;
      const selection = await readFile(selector, "utf8");
      if (!observed.has(selection)) await completeSelection(project, selection);
      observed.add(selection);
      await delay(20);
    }
    expect(overlapped).toBe(true);

    const winner = await readFile(selector, "utf8");
    observed.add(winner);
    const published = await Promise.all(
      (await results).map(async (result) => {
        if (result.status === "rejected") throw result.reason;
        expect(result.value).toMatchObject({ code: 0, signal: null });
        const { id } = parseManifest(result.value.stdout);
        const selection = await readFile(join(builds, id, "manifest.json"), "utf8");
        expect(parseManifest(selection).id).toBe(id);
        await completeSelection(project, selection);
        return { id, selection };
      }),
    );
    expect(new Set(published.map(({ id }) => id)).size).toBe(2);
    for (const selection of observed)
      expect([initial, ...published.map((build) => build.selection)]).toContain(selection);
    expect(published.map(({ selection }) => selection)).toContain(winner);
    expect((await readdir(builds)).sort()).toEqual(
      [parseManifest(initial).id, ...published.map(({ id }) => id)].sort(),
    );
    const pointer: unknown = JSON.parse(await readFile(join(compile, "metadata.json"), "utf8"));
    expect(pointer).toMatchObject({ manifest: "manifest.json", metadataField: "metadataPath" });
  });
}, 720_000);
