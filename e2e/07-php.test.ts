import { Connection, WorkflowClient } from "@temporalio/client";
import { randomUUID } from "node:crypto";
import { globSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const example = fileURLToPath(new URL("./fixtures/php/", import.meta.url));
const workflowDir = "src/temporal/workflows";
const workerDir = "workers/php-native";
const workerStart = { executable: "rr", args: ["serve", "-c", ".rr.yaml"], cwd: workerDir };

async function selectedBuild(project: string) {
  const manifest: unknown = JSON.parse(
    await readFile(join(project, ".gsys", "compile", "manifest.json"), "utf8"),
  );
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("root" in manifest) ||
    typeof manifest.root !== "string" ||
    !("id" in manifest) ||
    typeof manifest.id !== "string" ||
    !("artifacts" in manifest) ||
    !Array.isArray(manifest.artifacts)
  )
    throw new Error("Published build has no root, ID, or artifacts.");

  const artifacts: unknown[] = manifest.artifacts;
  const registrations: string[] = [];
  for (const artifact of artifacts) {
    if (
      artifact &&
      typeof artifact === "object" &&
      "kind" in artifact &&
      artifact.kind === "registration" &&
      "path" in artifact &&
      typeof artifact.path === "string"
    )
      registrations.push(await readFile(join(manifest.root, artifact.path), "utf8"));
  }
  return { manifest, root: manifest.root, id: manifest.id, registrations };
}

test("the packed CLI preserves PHP registration scopes, construction, and native RoadRunner launch", async () => {
  await withFixture(
    [
      ["php", "--version"],
      ["composer", "--version"],
      ["rr", "--version"],
      ["temporal", "--version"],
    ],
    async (fixture) => {
      const { project } = fixture;
      await cp(example, project, { recursive: true });
      const marker = join(fixture.root, "php-execution");
      const env = { GENESYS_PHP_MARKERS: marker };
      const sharedName = `<?php
namespace GenesysPhp;

use Temporal\\Workflow\\{WorkflowInterface, WorkflowMethod};

#[WorkflowInterface]
final class IndependentWorkflow
{
    #[WorkflowMethod(name: 'php.greet')]
    public function run(): string { return 'independent'; }
}
`;
      const testSource = join(project, workflowDir, "IndependentTest.php");
      await writeFile(testSource, sharedName);

      // Static analysis must not execute Composer, autoload, constructors or factories.
      // Two Workflow classes share a file. Grouped Activity methods have distinct native names.
      const inspection = await fixture.gsys(["inspect"], { env });
      expect(inspection.code).toBe(0);
      const discovered: unknown = JSON.parse(inspection.stdout);
      const identities = [
        ["workflow", "GenesysPhp\\GreetingWorkflow", "php.greet"],
        ["workflow", "GenesysPhp\\ObsoleteWorkflow", "php.obsolete"],
        ["activity", "GenesysPhp\\GreetingActivities::greet", "php.greeting.compose"],
        ["activity", "GenesysPhp\\GreetingActivities::suffix", "php.greeting.suffix"],
      ];
      expect(discovered).toMatchObject({
        packages: [expect.objectContaining({ language: "php", root: "." })],
        definitions: expect.arrayContaining(
          identities.map(([kind, symbol, name]) =>
            expect.objectContaining({ kind, symbol, identity: { state: "resolved", name } }),
          ),
        ),
        workers: [
          expect.objectContaining({ language: "php", name: "php-native", start: workerStart }),
        ],
      });
      expect(discovered).toHaveProperty(
        "definitions",
        expect.toSatisfy(
          (definitions: unknown) =>
            Array.isArray(definitions) && definitions.length === identities.length,
        ),
      );
      expect(discovered).not.toHaveProperty(
        "entries",
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringMatching(/(?:IndependentTest|NativeOptions)\.php$/),
          }),
        ]),
      );
      expect(inspection.stderr).toMatch(/info php\.sdk-version.*Composer lock resolves v?2\.20/);
      expect(inspection.stderr).toContain(
        `warning php.unresolved-hierarchy ${workflowDir}/ExplicitWorkflow.php`,
      );
      for (const path of [marker, join(project, "composer-build-marker")])
        await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await rm(testSource);

      // Source relocation within a root must preserve Workflow identity.
      const original = join(project, workflowDir, "GreetingWorkflows.php");
      const moved = join(project, workflowDir, "orders", "GreetingWorkflows.php");
      await mkdir(join(project, workflowDir, "orders"));
      await rename(original, moved);
      const relocated = await fixture.gsys(["inspect"], { env });
      expect(relocated.code).toBe(0);
      expect(JSON.parse(relocated.stdout)).toMatchObject({
        definitions: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({
              path: `${workflowDir}/orders/GreetingWorkflows.php`,
            }),
            symbol: "GenesysPhp\\GreetingWorkflow",
            identity: { state: "resolved", name: "php.greet" },
          }),
        ]),
      });

      // A native declaration error must be distinguished from unresolved assembly
      // and the SDK's absent Nexus handler API. Two configs must leave the command unset.
      const ambiguous = join(project, workerDir, ".rr.yml");
      const invalid = join(project, workflowDir, "InvalidWorkflow.php");
      const nexus = join(project, "src/temporal/nexus", "NexusProbe.php");
      await cp(join(project, workerDir, ".rr.yaml"), ambiguous);
      await writeFile(
        invalid,
        sharedName
          .replace("IndependentWorkflow", "InvalidWorkflow")
          .replace(
            "return 'independent'; }",
            "return 'invalid'; }\n\n    #[WorkflowMethod(name: 'php.second')]\n    public function second(): string { return 'second'; }",
          ),
      );
      await mkdir(join(project, "src/temporal/nexus"));
      await writeFile(nexus, "<?php\nnamespace GenesysPhp;\nfinal class NexusProbe {}\n");
      const diagnostics = await fixture.gsys(["inspect"], { env });
      expect(diagnostics.code).toBe(1);
      expect(diagnostics.stderr).toContain(
        `error php.workflow-handlers ${workflowDir}/InvalidWorkflow.php`,
      );
      expect(diagnostics.stderr).toContain(
        `warning php.unresolved-hierarchy ${workflowDir}/ExplicitWorkflow.php`,
      );
      expect(diagnostics.stderr).toContain(
        "warning php.sdk.nexus-unavailable src/temporal/nexus/NexusProbe.php",
      );
      expect(diagnostics.stderr).toContain("warning php.worker-entrypoint");
      expect(JSON.parse(diagnostics.stdout)).toMatchObject({
        workers: [expect.not.objectContaining({ start: expect.anything() })],
      });
      const details: unknown = JSON.parse(
        await readFile(join(project, ".gsys", "discovery", "diagnostics.json"), "utf8"),
      );
      expect(details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "php.worker-entrypoint",
            related: expect.arrayContaining([
              { path: `${workerDir}/.rr.yaml` },
              { path: `${workerDir}/.rr.yml` },
            ]),
          }),
        ]),
      );
      await Promise.all([rm(ambiguous), rm(invalid)]);

      // A duplicate identity omits the generated closure for its discovery root.
      // Separate discovery roots in the same Composer package can use that identity.
      const collision = join(project, workflowDir, "IndependentWorkflow.php");
      await writeFile(collision, sharedName);
      const collided = await fixture.gsys(["build"], { env });
      expect(collided.code).toBe(0);
      expect(collided.stderr).toContain("warning php.generated-scope-collision");
      expect(collided.stderr).toContain("workflow:php.greet occurs more than once");
      const collisionBuild = await selectedBuild(project);
      expect(collisionBuild.registrations).toHaveLength(0);
      expect(
        globSync(".gsys/compile/php/*/registration.php", { cwd: collisionBuild.root }),
      ).toHaveLength(0);
      const independent = join(project, "src/independent/temporal/workflows");
      await mkdir(independent, { recursive: true });
      await rename(collision, join(independent, "IndependentWorkflow.php"));

      const built = await fixture.gsys(["build"], { env });
      expect(built.code).toBe(0);
      const first = await selectedBuild(project);
      expect(first.registrations).toHaveLength(2);
      expect(first.registrations).toEqual(
        expect.arrayContaining([
          expect.stringContaining("GenesysPhp\\ObsoleteWorkflow::class"),
          expect.stringContaining("GenesysPhp\\IndependentWorkflow::class"),
        ]),
      );
      const registrationCode = first.registrations.join("\n");
      expect(registrationCode.match(/registerActivity\(/g)).toHaveLength(1);
      expect(registrationCode).not.toContain("ExplicitWorkflow::class");
      expect(registrationCode).not.toContain("NexusProbe::class");
      await expect(readFile(join(first.root, "composer-build-marker"), "utf8")).resolves.toBe(
        "installed",
      );

      // The installed Worker API supplies the capability check for the exact
      // Composer snapshot that was used to build the application.
      const sdk = await fixture.run(
        "php",
        [
          "-r",
          "require 'vendor/autoload.php'; " +
            "echo Composer\\InstalledVersions::getPrettyVersion('temporal/sdk'), PHP_EOL; " +
            "echo implode(PHP_EOL, get_class_methods(Temporal\\Worker\\WorkerInterface::class));",
        ],
        { cwd: first.root },
      );
      expect(sdk.code).toBe(0);
      expect(sdk.stdout).toMatch(/^v?2\.20\r?\n/);
      expect(sdk.stdout).toContain("registerWorkflowTypes");
      expect(sdk.stdout).not.toMatch(/nexus/i);

      // The next build must replace the removed registration and preserve the
      // current authored source. CLI dev launches the generated snapshot in native cwd.
      const before = await readFile(moved, "utf8");
      const after = before
        .replace("ObsoleteWorkflow", "AddedWorkflow")
        .replace("php.obsolete", "php.added")
        .replace("return 'obsolete';", "return 'added';");
      await writeFile(moved, after);
      await rm(independent, { recursive: true });
      const endpoint = await temporalEndpoint();
      const rpc = await temporalEndpoint();
      const dev = fixture.startGsys(["dev", "--", ...endpoint.serverArgs], {
        env: { ...env, ...endpoint.workerEnv, GENESYS_PHP_RPC_PORT: String(rpc.port) },
      });
      const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "45s" });
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
        const client = new WorkflowClient({ connection, namespace: endpoint.namespace });
        await connection.withDeadline(Date.now() + 50_000, async () => {
          const options = () => ({
            taskQueue: "genesys-php",
            workflowId: randomUUID(),
            workflowExecutionTimeout: 40_000,
          });
          const greeting = await client.start("php.greet", { ...options(), args: ["Genesys"] });
          await greeting.signal("php.release");
          await expect(greeting.result()).resolves.toBe("intercepted: factory Genesys!");
          const history = await greeting.fetchHistory();
          expect(history.events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                workflowTaskCompletedEventAttributes: expect.objectContaining({
                  identity: "genesys-php-authored-options",
                }),
              }),
            ]),
          );
          await expect(client.execute("php.explicit", options())).resolves.toBe("explicit");
          await expect(client.execute("php.added", options())).resolves.toBe("added");
        });
      } finally {
        await connection.close();
      }
      dev.signal("SIGINT");
      const stopped = await dev.wait(45_000);
      expect(stopped).toMatchObject({
        code: 0,
        signal: null,
        stdout: expect.stringMatching(/\[php-native@[^\]]+\] started PID \d+/),
      });

      const second = await selectedBuild(project);
      expect(second.id).not.toBe(first.id);
      expect(second.manifest).toMatchObject({
        workers: [
          expect.objectContaining({ start: { ...workerStart, cwd: join(second.root, workerDir) } }),
        ],
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: "registration" }),
          expect.objectContaining({ kind: "native-output", path: "vendor/autoload.php" }),
        ]),
        discovery: expect.objectContaining({
          definitions: expect.not.arrayContaining([
            expect.objectContaining({ symbol: "GenesysPhp\\ObsoleteWorkflow" }),
          ]),
        }),
      });
      expect(second.registrations).toHaveLength(1);
      expect(second.registrations[0]).toContain("GenesysPhp\\AddedWorkflow::class");
      expect(second.registrations[0]).not.toContain("ObsoleteWorkflow::class");
      expect(second.registrations[0]).not.toContain("ExplicitWorkflow::class");
      await expect(
        readFile(join(second.root, "src/temporal/lib/NativeOptions.php"), "utf8"),
      ).resolves.toBe(await readFile(join(project, "src/temporal/lib/NativeOptions.php"), "utf8"));
      await expect(readFile(moved, "utf8")).resolves.toBe(after);
      const events = (await readFile(marker, "utf8")).trim().split("\n");
      expect(events).toEqual(
        expect.arrayContaining(["autoload", "workflow-source", "constructor", "factory"]),
      );
    },
  );
}, 720_000);
