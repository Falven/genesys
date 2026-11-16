import type { AnalysisContext, AnalysisResult } from "../../contracts.js";
import { analyzeDefinition } from "./definitions.js";
import { inspectSources } from "./inspection.js";
import type { Parsed, Registration } from "./model.js";
import { resolveTypes } from "./resolution.js";
import { planWorkers } from "./workers.js";

export async function analyzeJava(
  context: AnalysisContext,
): Promise<{ analysis: AnalysisResult; registrations: Registration[] }> {
  const result: AnalysisResult = { definitions: [], diagnostics: [], workers: [] };
  const registrations: Registration[] = [];
  for (const entry of context.entries.filter((entry) => entry.path.endsWith(".kt")))
    result.diagnostics.push({
      code: "java.kotlin-analysis-unavailable",
      severity: "warning",
      source: { path: entry.path },
      message:
        "Kotlin is supported by the Java SDK. This Java compiler reader cannot analyze Kotlin; retain explicit native assembly.",
    });
  let parsed: Parsed;
  try {
    parsed = await inspectSources(context);
  } catch (error) {
    result.diagnostics.push({
      code: "java.parser-unavailable",
      severity: "error",
      message: `Java analysis requires a JDK 17+ available through JAVA_HOME or PATH. No application code was executed. ${error instanceof Error ? error.message : String(error)}`,
    });
    return { analysis: result, registrations };
  }
  for (const diagnostic of parsed.diagnostics)
    result.diagnostics.push({
      code: "java.syntax",
      severity: diagnostic.error ? "error" : "warning",
      source: { path: diagnostic.path, line: diagnostic.line },
      message: diagnostic.message,
    });

  const resolver = resolveTypes(parsed.types);
  const workerPlan = await planWorkers(context, parsed);
  const entries = new Map(context.entries.map((entry) => [entry.path, entry]));
  for (const type of parsed.types) {
    const entry = entries.get(type.path);
    if (!entry) continue;
    if (entry.role === "worker") {
      const plan = workerPlan.forType(type, entry);
      result.workers.push(...plan.workers);
      result.diagnostics.push(...plan.diagnostics);
    } else {
      const analyzed = analyzeDefinition(type, { ...entry, role: entry.role }, resolver);
      result.definitions.push(...analyzed.definitions);
      result.diagnostics.push(...analyzed.diagnostics);
      registrations.push(...analyzed.registrations);
    }
  }
  const completed = workerPlan.finish(result.workers);
  result.workers = completed.workers;
  result.diagnostics.push(...completed.diagnostics);
  return { analysis: result, registrations };
}
