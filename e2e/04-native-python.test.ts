import { Connection } from "@temporalio/client";
import { access, cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/python/", import.meta.url));
const packagePath = "src/python_probe";
const discoveryRoot = `${packagePath}/temporal`;
const workerPath = `${discoveryRoot}/workers/greeting/main.py`;
const activityPath = `${discoveryRoot}/activities/greeting.py`;
const optionsPath = `${packagePath}/options.py`;

test("Python inspection preserves scoped identities without executing imports, constructors, or build hooks", async () => {
  await withFixture([["python3", "--version"]], async (fixture) => {
    await cp(source, fixture.project, { recursive: true });
    const probeRoot = `${packagePath}/auxiliary/temporal`;
    const probe = `${probeRoot}/activities/probe.py`;
    const first = `${probeRoot}/workers/first/main.py`;
    const second = `${probeRoot}/workers/second/main.py`;
    const alternate = `${probeRoot}/workers/first/alternate.py`;
    const invalid = `${probeRoot}/activities/invalid.py`;
    const markers = {
      import: join(fixture.root, "import-ran"),
      constructor: join(fixture.root, "constructor-ran"),
      build: join(fixture.root, "build-hook-ran"),
    };
    const worker = (activities: string) => `from temporalio.worker import Worker
from python_probe.auxiliary.temporal.activities.probe import First, one, two

if __name__ == "__main__":
    First()
    Worker(None, task_queue="probe", activities=[${activities}])
`;
    const probes: [string, string][] = [
      [
        probe,
        `from pathlib import Path
Path(${JSON.stringify(markers.import)}).touch()

from temporalio.activity import defn as native_activity

class First:
    def __init__(self):
        Path(${JSON.stringify(markers.constructor)}).touch()

@native_activity(name="Scoped")
async def one():
    return "one"

@native_activity(name="Scoped")
async def two():
    return "two"

@native_activity(name="Computed".lower())
async def computed():
    return "computed"
`,
      ],
      [first, worker("one")],
      [second, worker("two")],
      [
        "setup.py",
        `from pathlib import Path
Path(${JSON.stringify(markers.build)}).touch()
raise RuntimeError("An inspect command ran the package build hook")
`,
      ],
    ];
    for (const [path, content] of probes) {
      const destination = join(fixture.project, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }

    const inspection = await fixture.gsys(["inspect"]);
    expect(inspection.code).toBe(0);
    const inspected: unknown = JSON.parse(inspection.stdout);
    expect(inspected).toMatchObject({
      analysis: "native-analysis",
      packages: [{ root: ".", language: "python" }],
      entries: expect.arrayContaining([
        expect.objectContaining({ path: activityPath, discoveryRoot, role: "activity" }),
        expect.objectContaining({ path: probe, discoveryRoot: probeRoot, role: "activity" }),
      ]),
      definitions: expect.arrayContaining(
        [
          ["workflow", "Greeting", "Greeting"],
          ["workflow", "Transform", "Transform"],
          ["activity", "Greeter.__compose", "ComposeGreeting"],
          ["activity", "legacy", "LegacyTransform"],
          ["nexus", "GreetingHandler", "GreetingService"],
        ].map(([kind, symbol, name]) =>
          expect.objectContaining({ kind, symbol, identity: { state: "resolved", name } }),
        ),
      ),
      workers: expect.arrayContaining([
        expect.objectContaining({ name: "greeting", source: { path: workerPath } }),
      ]),
    });
    expect(inspected).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          symbol: "Greeter.__compose",
          construction: expect.objectContaining({ symbol: "Greeter" }),
        }),
        ...[
          ["one", first],
          ["two", second],
        ].map(([symbol, path]) =>
          expect.objectContaining({
            symbol,
            identity: { name: "Scoped", state: "resolved" },
            registrationScope: expect.stringContaining(`${path}:`),
          }),
        ),
        expect.objectContaining({
          symbol: "computed",
          identity: expect.objectContaining({ state: "unresolved" }),
        }),
      ]),
    });
    for (const unexpected of ["ExplicitGreeting", "AccidentalTestActivity", "ChooseName", "reject"])
      expect(inspected).toMatchObject({
        definitions: expect.not.arrayContaining([
          expect.objectContaining({ identity: expect.objectContaining({ name: unexpected }) }),
        ]),
      });
    expect(inspection.stderr).toContain("warning python.identity-unresolved");
    expect(inspection.stderr).not.toContain("python.native-registration-collision");

    await writeFile(join(fixture.project, first), worker("one, two"));
    await writeFile(join(fixture.project, alternate), 'if __name__ == "__main__":\n    pass\n');
    await writeFile(
      join(fixture.project, invalid),
      "from temporalio import activity\n@activity.defn\n",
    );
    const failure = await fixture.gsys(["inspect"]);
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain(`error python.native-registration-collision ${first}`);
    expect(failure.stderr).toContain("Duplicate native activities identity 'Scoped'");
    expect(failure.stderr).toContain(`error python.syntax ${invalid}`);
    const ambiguity = failure.stderr
      .split("\n")
      .find((line) => line.includes("warning python.worker-entrypoint-unresolved"));
    expect(ambiguity).toContain("first; found 2:");
    expect(ambiguity).toContain("workers.first.alternate");
    expect(ambiguity).toContain("workers.first.main");
    const ambiguous: unknown = JSON.parse(failure.stdout);
    expect(ambiguous).toMatchObject({
      workers: expect.arrayContaining([
        expect.objectContaining({ name: "first", source: { path: alternate } }),
      ]),
    });
    expect(ambiguous).toMatchObject({
      workers: expect.not.arrayContaining([
        expect.objectContaining({ name: "first", start: expect.anything() }),
      ]),
    });
    for (const marker of Object.values(markers))
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
}, 300_000);

test("published Python console scripts load their own generated registration and authored options", async () => {
  await withFixture(
    [
      ["python3", "--version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      await cp(source, fixture.project, { recursive: true });
      const selectedPath = join(fixture.project, ".gsys", "compile", "manifest.json");
      const project = await realpath(fixture.project);

      async function publish() {
        const result = await fixture.gsys(["build"]);
        expect(result.code).toBe(0);
        const selected: unknown = JSON.parse(await readFile(selectedPath, "utf8"));
        expect(selected).toMatchObject({
          schemaVersion: 1,
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              kind: "registration",
              path: expect.stringMatching(/\/activities\.py$/),
            }),
            expect.objectContaining({
              kind: "registration",
              path: expect.stringMatching(/\/workflows\.py$/),
            }),
            expect.objectContaining({
              kind: "registration",
              path: expect.stringMatching(/\/nexus\.py$/),
            }),
          ]),
        });
        if (
          !selected ||
          typeof selected !== "object" ||
          !("id" in selected) ||
          typeof selected.id !== "string" ||
          !("root" in selected) ||
          typeof selected.root !== "string" ||
          !("workers" in selected) ||
          !Array.isArray(selected.workers) ||
          selected.workers.length !== 1
        )
          throw new Error("Expected a published build with one native Worker");
        const [worker]: unknown[] = selected.workers;
        if (!worker || typeof worker !== "object" || !("start" in worker))
          throw new Error("The published Worker is missing its startup command");
        const start = worker.start;
        if (
          !start ||
          typeof start !== "object" ||
          !("executable" in start) ||
          typeof start.executable !== "string" ||
          !("cwd" in start) ||
          typeof start.cwd !== "string" ||
          !("args" in start) ||
          !Array.isArray(start.args) ||
          !start.args.every((argument: unknown) => typeof argument === "string") ||
          !("env" in start) ||
          !start.env ||
          typeof start.env !== "object"
        )
          throw new Error("The published Worker startup command is invalid");
        const env = Object.fromEntries(
          Object.entries(start.env).map(([key, value]): [string, string] => {
            if (typeof value !== "string")
              throw new Error(`Invalid Worker environment entry ${key}`);
            return [key, value];
          }),
        );
        const root = selected.root;
        const prefix = join(root, ".gsys", "python-env");
        expect(root).toBe(join(project, ".gsys", "compile", "builds", selected.id, "project"));
        expect(start.cwd).toBe(root);
        expect(start.executable).toBe(join(prefix, "bin", "genesys-python-worker"));
        expect(start.args).toEqual([]);
        const python = join(prefix, "bin", "python");
        const consoleScript = await readFile(start.executable, "utf8");
        expect(consoleScript).toContain(python);
        const roots = env.PYTHONPATH?.split(delimiter);
        expect(roots).toEqual([
          join(root, "src"),
          expect.stringMatching(/^.+[/\\]\.gsys[/\\]compile[/\\]python[/\\][a-f\d]+$/),
        ]);
        const generated = roots?.[1];
        if (!generated) throw new Error("Expected the generated Python import root");
        expect(dirname(generated)).toBe(join(root, ".gsys", "compile", "python"));
        return {
          id: selected.id,
          root,
          prefix,
          python,
          generated,
          executable: start.executable,
          args: start.args,
          cwd: start.cwd,
          env,
        };
      }

      const initial = await publish();
      const activityFile = join(fixture.project, activityPath);
      const optionsFile = join(fixture.project, optionsPath);
      const originalActivity = await readFile(activityFile, "utf8");
      const originalOptions = await readFile(optionsFile, "utf8");
      const revisedActivity = originalActivity
        .replace("LegacyTransform", "NewTransform")
        .replace("async def legacy", "async def replacement")
        .replace("name.upper()", "name.lower()");
      const revisedOptions = originalOptions.replace('"Hello"', '"Updated"');
      await writeFile(activityFile, revisedActivity);
      await writeFile(optionsFile, revisedOptions);
      const revised = await publish();
      expect(revised.id).not.toBe(initial.id);
      expect(await readFile(activityFile, "utf8")).toBe(revisedActivity);
      expect(await readFile(optionsFile, "utf8")).toBe(revisedOptions);

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
      } finally {
        await connection.close();
      }
      const nexus = await fixture.run("temporal", [
        "operator",
        "nexus",
        "endpoint",
        "create",
        "--name",
        endpoint.namespace,
        "--target-namespace",
        endpoint.namespace,
        "--target-task-queue",
        "genesys-python",
        "--address",
        endpoint.address,
        "--disable-config-env",
        "--disable-config-file",
      ]);
      expect(nexus.code).toBe(0);

      for (const [build, salutation, transform, selected, missing] of [
        [initial, "Hello", "ADA", "LegacyTransform", "NewTransform"],
        [revised, "Updated", "ada", "NewTransform", "LegacyTransform"],
      ] satisfies [Awaited<ReturnType<typeof publish>>, string, string, string, string][]) {
        const command = { cwd: build.cwd, env: { ...build.env, ...endpoint.workerEnv } };
        const worker = fixture.start(build.executable, build.args, command);
        const client = await fixture.run(
          build.python,
          ["-m", "python_probe.client", endpoint.namespace, selected, missing],
          command,
        );
        expect(client.code).toBe(0);
        const result: unknown = JSON.parse(client.stdout);
        expect(result).toMatchObject({
          updateRejected: expect.stringContaining("A nonempty name is required"),
          updateResult: "Ada",
          greeting: [
            `intercepted/${salutation}, Ada!`,
            "explicit/Ada",
            `${salutation}/echo/Ada`,
            expect.stringContaining(`${salutation}/reject/Ada`),
          ],
          transform,
          missing: expect.stringContaining(`Activity function ${missing}`),
          temporalio: "1.36.1",
          nexus: "1.5.0",
        });
        await worker.stop();
        const stopped = await worker.wait();
        expect(stopped.code).toBe(0);
        const launch: unknown = JSON.parse(stopped.stdout);
        expect(launch).toMatchObject({
          cwd: build.root,
          prefix: build.prefix,
          python: build.python,
          options: join(build.root, optionsPath),
          registration: join(build.generated, "gsys_generated_5909144ccd67", "activities.py"),
        });
      }
    },
  );
}, 720_000);
