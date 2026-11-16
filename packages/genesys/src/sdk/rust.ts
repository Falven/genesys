import type { AnalysisResult, Diagnostic, NativeAdapter } from "../contracts.js";
import { planAnalysis } from "./rust/analysis.js";
import { inspect } from "./rust/inspect.js";
import type { RustAnalysis } from "./rust/model.js";
import { emitRegistration } from "./rust/registration.js";

function diagnostic(error: unknown): Diagnostic {
  return {
    code: "rust.analysis-unavailable",
    severity: "error",
    message: `Rust static analysis failed: ${error instanceof Error ? error.message : String(error)}. Authored native assembly remains available; no definitions were guessed.`,
  };
}
const analyses = new WeakMap<AnalysisResult, RustAnalysis>();

export const rustAdapter: NativeAdapter = {
  language: "rust",
  async analyze(context) {
    let parsed: RustAnalysis;
    try {
      parsed = await inspect(context);
    } catch (error) {
      return { definitions: [], workers: [], diagnostics: [diagnostic(error)] };
    }
    const result = planAnalysis(context, parsed);
    analyses.set(result, parsed);
    return result;
  },
  async emit(context) {
    const parsed = analyses.get(context.analysis);
    if (!parsed)
      throw new Error("Rust emission requires the native analysis result from this process.");
    return emitRegistration(context, parsed);
  },
};
