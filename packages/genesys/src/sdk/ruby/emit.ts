import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { Definition, EmitContext, EmissionResult, SourceEntry } from "../../contracts.js";

const rubyString = (value: string) => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

export async function emit(
  context: EmitContext,
  requiredInputs: ReadonlySet<string>,
): Promise<EmissionResult> {
  const result: EmissionResult = { artifacts: [], diagnostics: [] };
  const root = posix.join(context.package.root, ".gsys/ruby");
  const packageModule = `Package${createHash("sha256").update(context.package.id).digest("hex").slice(0, 16)}`;
  const collections: { entry: SourceEntry; module: string; path: string; inputs: Definition[] }[] =
    [];
  for (const entry of context.entries.filter(
    (entry) => entry.language === "ruby" && entry.role !== "worker",
  )) {
    const definitions = context.analysis.definitions.filter((item) => item.entryId === entry.id);
    if (!definitions.length) continue;
    const hash = createHash("sha256").update(entry.path).digest("hex").slice(0, 16);
    const module = `Entry${hash}`;
    const path = posix.join(root, `${hash}.rb`);
    const eligible = definitions.filter((item) => !item.construction);
    const inputs = definitions.filter((item) => requiredInputs.has(item.id));
    const lines = [
      "# frozen_string_literal: true",
      "# Generated native Worker registration inputs. Do not edit.",
      `require_relative ${rubyString(posix.relative(root, entry.path))}`,
      "",
      "module GenesysGenerated",
      `  module ${packageModule}`,
      `  module ${module}`,
    ];
    lines.push(
      `    WORKFLOWS = [${eligible
        .filter((item) => item.kind === "workflow")
        .map((item) => `::${item.symbol}`)
        .join(", ")}].freeze`,
      ...inputs.map((item, index) => `    # instance_${index}: ::${item.symbol}`),
      `    def self.activities(${inputs.map((_, index) => `instance_${index}`).join(", ")})`,
      `      [${[...eligible.filter((item) => item.kind === "activity").map((item) => `::${item.symbol}`), ...inputs.map((_, index) => `instance_${index}`)].join(", ")}].freeze`,
      "    end",
      ...(inputs.length ? [] : ["    ACTIVITIES = activities"]),
      "  end",
      "  end",
      "end",
      "",
    );
    for (const definition of definitions.filter(
      (item) => item.construction && !requiredInputs.has(item.id),
    ))
      result.diagnostics.push({
        code: "ruby.registration-needs-assembly",
        severity: "warning",
        source: definition.source,
        message: `${definition.symbol} is not in generated arrays: ${definition.construction!.reason} Supply its existing native instance/Info through authored Worker options.`,
      });
    result.artifacts.push({ path, content: lines.join("\n"), kind: "registration" });
    collections.push({ entry, module, path, inputs });
  }
  const inputs = collections.flatMap((item) => item.inputs);
  const lines = [
    "# frozen_string_literal: true",
    "# Generated collections; application Worker code chooses its native registration scope.",
    ...collections.map((item) => `require_relative ${rubyString(posix.basename(item.path))}`),
    "",
    "module GenesysGenerated",
    `  module ${packageModule}`,
    `  WORKFLOWS = [${collections.map((item) => `*${item.module}::WORKFLOWS`).join(", ")}].freeze`,
    ...inputs.map((item, index) => `  # instance_${index}: ::${item.symbol}`),
    `  def self.activities(${inputs.map((_, index) => `instance_${index}`).join(", ")})`,
    `    [${collections.map((item) => `*${item.module}.activities(${item.inputs.map((input) => `instance_${inputs.indexOf(input)}`).join(", ")})`).join(", ")}].freeze`,
    "  end",
    ...(inputs.length ? [] : ["  ACTIVITIES = activities"]),
    "  end",
    "end",
    "",
  ];
  result.artifacts.push({
    path: posix.join(root, "registration.rb"),
    content: lines.join("\n"),
    kind: "registration",
  });
  const manifest = {
    inspectedSdk: "temporalio 1.11.0",
    module: `GenesysGenerated::${packageModule}`,
    activities: {
      method: "activities",
      instances: inputs.map((item, index) => ({
        parameter: `instance_${index}`,
        type: item.symbol,
      })),
    },
    collections: collections.map((item) => ({
      source: item.entry.path,
      path: item.path,
      module: `GenesysGenerated::${packageModule}::${item.module}`,
      instances: item.inputs.map((input, index) => ({
        parameter: `instance_${index}`,
        type: input.symbol,
      })),
    })),
  };
  result.artifacts.push({
    path: posix.join(root, "manifest.json"),
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    kind: "metadata",
  });
  return result;
}
