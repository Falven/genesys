import { Connection } from "@temporalio/client";
import assert from "node:assert/strict";
import { appendFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { temporalEndpoint, withFixture } from "./fixture.js";

const source = fileURLToPath(new URL("./fixtures/ruby/", import.meta.url));
const packageRoot = "ruby-app";
const workflows = "temporal/workflows/greetings.rb";
const activities = "temporal/activities/greetings.rb";
const executable = "bin/ruby-greeting";
const rubyTools = [["ruby", "--version"]] as const;

test("Ruby inspection preserves native identities, isolates Worker scopes, and leaves application code inert", async () => {
  await withFixture(rubyTools, async (fixture) => {
    const app = join(fixture.project, packageRoot);
    await cp(source, app, { recursive: true });
    const marker = join(fixture.root, "authored-code-ran");
    const sideEffect = "\nFile.write(ENV.fetch('GSYS_RUBY_INSPECT_MARKER'), __FILE__)\n";
    for (const path of ["Gemfile", activities, "lib/greeting_options.rb"])
      await appendFile(join(app, path), sideEffect);
    const activityPath = join(app, activities);
    const activitySource = await readFile(activityPath, "utf8");
    await writeFile(
      activityPath,
      activitySource.replace(
        "def initialize(prefix)",
        "def initialize(prefix)\n      File.write(ENV.fetch('GSYS_RUBY_INSPECT_MARKER'), __FILE__)",
      ),
    );
    await mkdir(join(app, "temporal/activities/lib"));
    await writeFile(
      join(app, "temporal/activities/lib/hidden.rb"),
      "class Helper < Temporalio::Activity::Definition; end\n",
    );
    await writeFile(
      join(app, "temporal/workflows/ignored_test.rb"),
      "class IgnoredTest < Temporalio::Workflow::Definition; end\n",
    );
    const inspect = () => fixture.gsys(["inspect"], { env: { GSYS_RUBY_INSPECT_MARKER: marker } });

    const initial = await inspect();
    expect(initial.code).toBe(0);
    const discovery: unknown = JSON.parse(initial.stdout);
    expect(discovery).toMatchObject({
      packages: [{ id: "ruby:ruby-app", root: packageRoot, manifests: [`${packageRoot}/Gemfile`] }],
      definitions: [
        {
          kind: "activity",
          symbol: "RubyGreeting::GreetingText",
          identity: { state: "resolved", name: "RubyGreetingText" },
          source: { path: `${packageRoot}/${activities}` },
        },
        {
          kind: "workflow",
          symbol: "RubyGreeting::Greeting",
          identity: { state: "resolved", name: "RubyGreeting" },
          source: { path: `${packageRoot}/${workflows}` },
        },
        {
          kind: "workflow",
          symbol: "RubyGreeting::RetiredGreeting",
          identity: { state: "resolved", name: "RetiredGreeting" },
          source: { path: `${packageRoot}/${workflows}` },
        },
        {
          kind: "activity",
          symbol: "RubyGreeting::INFO",
          identity: { state: "resolved", name: "RubyPunctuation" },
          source: { path: `${packageRoot}/${activities}` },
        },
      ],
      workers: [
        {
          name: "ruby-greeting",
          start: {
            executable: "bundle",
            args: ["exec", "ruby", "--", executable],
            cwd: packageRoot,
          },
        },
      ],
    });
    expect(initial.stderr).toContain(
      "info ruby.instance-required ruby-app/temporal/activities/greetings.rb",
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });

    const moved = "temporal/workflows/moved.rb";
    await rename(join(app, workflows), join(app, moved));
    await mkdir(join(app, "secondary/temporal/workflows"), { recursive: true });
    await mkdir(join(app, "temporal/nexus"));
    await mkdir(join(app, "exe"));
    await writeFile(
      join(app, "secondary/temporal/workflows/alternate.rb"),
      `require 'temporalio/workflow'
class Alternate < Temporalio::Workflow::Definition
  workflow_name 'RubyGreeting'
  def execute
    'alternate'
  end
end
class Computed < Temporalio::Workflow::Definition
  workflow_name ENV.fetch('WORKFLOW_NAME', 'Computed')
  def execute
    'computed'
  end
end
`,
    );
    await writeFile(join(app, "temporal/nexus/handler.rb"), "# SDK capability probe\n");
    const scopes = `#!/usr/bin/env ruby
require 'temporalio/worker'
require_relative '../${moved}'
require_relative '../secondary/temporal/workflows/alternate'
client = Temporalio::Client.connect(ENV.fetch('TEMPORAL_ADDRESS'), ENV.fetch('TEMPORAL_NAMESPACE'))
first = Temporalio::Worker.new(client: client, task_queue: 'first', workflows: [RubyGreeting::Greeting])
second = Temporalio::Worker.new(client: client, task_queue: 'second', workflows: [Alternate, Computed])
Temporalio::Worker.run_all(first, second)
`;
    await writeFile(join(app, "exe/scopes"), scopes);
    const independent = await inspect();
    expect(independent.code).toBe(0);
    const movedDiscovery: unknown = JSON.parse(independent.stdout);
    expect(movedDiscovery).toMatchObject({
      definitions: expect.arrayContaining([
        expect.objectContaining({
          symbol: "RubyGreeting::Greeting",
          identity: { state: "resolved", name: "RubyGreeting" },
          source: expect.objectContaining({ path: `${packageRoot}/${moved}` }),
        }),
        expect.objectContaining({
          symbol: "Alternate",
          identity: { state: "resolved", name: "RubyGreeting" },
        }),
        expect.objectContaining({
          symbol: "Computed",
          identity: expect.objectContaining({ state: "unresolved" }),
        }),
      ]),
      workers: expect.arrayContaining([
        expect.objectContaining({
          name: "scopes",
          start: {
            executable: "bundle",
            args: ["exec", "ruby", "--", "exe/scopes"],
            cwd: packageRoot,
          },
        }),
      ]),
    });
    expect(independent.stderr).toContain(
      "warning ruby.identity-unresolved ruby-app/secondary/temporal/workflows/alternate.rb",
    );
    expect(independent.stderr).toContain(
      "warning ruby.sdk-nexus-unavailable ruby-app/temporal/nexus/handler.rb",
    );

    await writeFile(
      join(app, "exe/scopes"),
      scopes.replace("[RubyGreeting::Greeting]", "[RubyGreeting::Greeting, Alternate]"),
    );
    const colliding = await inspect();
    expect(colliding.code).toBe(1);
    expect(colliding.stderr).toContain(
      "error ruby.identity-collision ruby-app/secondary/temporal/workflows/alternate.rb: Native Worker workflow registrations repeat RubyGreeting.",
    );
    const diagnostics: unknown = JSON.parse(
      await readFile(join(fixture.project, ".gsys/discovery/diagnostics.json"), "utf8"),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ruby.identity-collision",
          related: [
            expect.objectContaining({ path: `${packageRoot}/${moved}` }),
            expect.objectContaining({ path: `${packageRoot}/exe/scopes` }),
          ],
        }),
      ]),
    );

    await rm(join(app, "exe/scopes"));
    await cp(join(app, executable), join(app, `${executable}.rb`));
    await writeFile(join(app, "temporal/workflows/invalid.rb"), "class Unclosed\n");
    const invalid = await inspect();
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("error ruby.syntax ruby-app/temporal/workflows/invalid.rb");
    expect(invalid.stderr).toContain("error worker.ambiguous-name ruby-app/bin/ruby-greeting.rb");
    const candidates: unknown = JSON.parse(
      await readFile(join(fixture.project, ".gsys/discovery/diagnostics.json"), "utf8"),
    );
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "worker.ambiguous-name",
          related: [expect.objectContaining({ path: `${packageRoot}/${executable}` })],
        }),
      ]),
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
}, 480_000);

function rubyStart(build: unknown) {
  assert(build && typeof build === "object" && "root" in build && typeof build.root === "string");
  assert("workers" in build && Array.isArray(build.workers) && build.workers.length === 1);
  const worker: unknown = build.workers[0];
  assert(worker && typeof worker === "object" && "start" in worker);
  assert(worker.start && typeof worker.start === "object");
  const start = worker.start;
  assert("executable" in start && typeof start.executable === "string");
  assert("cwd" in start && typeof start.cwd === "string");
  assert("args" in start && Array.isArray(start.args));
  const args: unknown[] = start.args;
  assert(args.every((argument) => typeof argument === "string"));
  expect(start).toEqual({
    executable: "bundle",
    args: ["exec", "ruby", "--", executable],
    cwd: join(build.root, packageRoot),
  });
  return { executable: start.executable, args, cwd: start.cwd };
}

test("Ruby builds run authored instances, native Signal and interceptor, and refresh generated registrations", async () => {
  await withFixture(
    [...rubyTools, ["bundle", "--version"], ["temporal", "--version"]],
    async (fixture) => {
      const app = join(fixture.project, packageRoot);
      await cp(source, app, { recursive: true });
      const installed = await fixture.run("bundle", ["install"], {
        cwd: app,
        env: { BUNDLE_FROZEN: "true" },
      });
      expect(installed.code).toBe(0);
      const capability = await fixture.run(
        "bundle",
        [
          "exec",
          "ruby",
          "-rtemporalio/worker",
          "-e",
          "puts Gem.loaded_specs.fetch('temporalio').version; puts Temporalio::Worker.instance_method(:initialize).parameters.none? { |_, name| name.to_s.include?('nexus') }",
        ],
        { cwd: app },
      );
      expect(capability.code).toBe(0);
      expect(capability.stdout.trim()).toBe("1.11.0\ntrue");

      const build = async () => {
        const publication = await fixture.gsys(["build"]);
        expect(publication.code).toBe(0);
        const selected: unknown = JSON.parse(
          await readFile(join(fixture.project, ".gsys/compile/manifest.json"), "utf8"),
        );
        assert(
          selected &&
            typeof selected === "object" &&
            "manifestPath" in selected &&
            typeof selected.manifestPath === "string",
        );
        const immutable: unknown = JSON.parse(await readFile(selected.manifestPath, "utf8"));
        expect(immutable).toEqual(selected);
        return rubyStart(immutable);
      };

      const first = await build();
      const original = await readFile(join(app, workflows), "utf8");
      const changed = original
        .replace("RetiredGreeting", "FreshGreeting")
        .replace("'retired'", "'fresh'");
      await writeFile(join(app, workflows), changed);
      const second = await build();
      expect(second.cwd).not.toBe(first.cwd);
      expect(await readFile(join(app, workflows), "utf8")).toBe(changed);
      for (const { cwd } of [first, second]) {
        const generated = join(cwd, ".gsys/ruby");
        const collections = (await readdir(generated)).filter((filename) =>
          filename.endsWith(".rb"),
        );
        const registration = (
          await Promise.all(
            collections.map((filename) => readFile(join(generated, filename), "utf8")),
          )
        ).join("\n");
        expect(registration).toContain(
          cwd === first.cwd ? "::RubyGreeting::RetiredGreeting" : "::RubyGreeting::FreshGreeting",
        );
        expect(registration).not.toContain(
          cwd === first.cwd ? "::RubyGreeting::FreshGreeting" : "::RubyGreeting::RetiredGreeting",
        );
      }

      await rm(join(app, "lib/greeting_options.rb"));
      const endpoint = await temporalEndpoint();
      fixture.start("temporal", ["server", "start-dev", ...endpoint.serverArgs]);
      const connection = Connection.lazy({ address: endpoint.address, connectTimeout: "30s" });
      try {
        await connection.ensureConnected();
        await expect
          .poll(
            () =>
              connection.withDeadline(Date.now() + 3_000, () =>
                connection.workflowService.describeNamespace({ namespace: endpoint.namespace }),
              ),
            { timeout: 10_000 },
          )
          .toMatchObject({ namespaceInfo: { name: endpoint.namespace } });
      } finally {
        await connection.close();
      }

      const client = async (cwd: string, workflow: string) => {
        const result = await fixture.run("bundle", ["exec", "ruby", "--", "client.rb", workflow], {
          cwd,
          env: endpoint.workerEnv,
          timeout: 30_000,
        });
        expect(result.code).toBe(0);
        const value: unknown = JSON.parse(result.stdout);
        return value;
      };

      const firstWorker = fixture.start(first.executable, first.args, {
        cwd: first.cwd,
        env: endpoint.workerEnv,
      });
      expect(await client(first.cwd, "RetiredGreeting")).toBe("retired");
      firstWorker.signal("SIGINT");
      expect(await firstWorker.wait(30_000)).toMatchObject({ code: 0, signal: null });

      const secondWorker = fixture.start(second.executable, second.args, {
        cwd: second.cwd,
        env: endpoint.workerEnv,
      });
      expect(await client(second.cwd, "FreshGreeting")).toBe("fresh");
      expect(await client(second.cwd, "RubyGreeting")).toEqual([
        "intercepted(Hello, Genesys)",
        "intercepted(!)",
        "intercepted(explicit)",
      ]);
      secondWorker.signal("SIGINT");
      expect(await secondWorker.wait(30_000)).toMatchObject({ code: 0, signal: null });
    },
  );
}, 480_000);
