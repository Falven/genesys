import type { AnalysisResult, NativeAdapter } from "../contracts.js";
import { analyzeJava } from "./java/analysis.js";
import { emitRegistration } from "./java/emission.js";
import type { Registration } from "./java/model.js";

const registrations = new WeakMap<AnalysisResult, Registration[]>();

async function analyze(context: Parameters<NativeAdapter["analyze"]>[0]) {
  const result = await analyzeJava(context);
  registrations.set(result.analysis, result.registrations);
  return result.analysis;
}

export const javaAdapter: NativeAdapter = {
  language: "java",
  analyze,
  async emit(context) {
    const reused = registrations.has(context.analysis);
    const analysis = reused ? context.analysis : await analyze(context);
    return emitRegistration(
      context,
      analysis,
      registrations.get(analysis) ?? [],
      reused ? [] : [...analysis.diagnostics],
    );
  },
};
