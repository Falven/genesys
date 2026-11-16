import type { AnalysisResult, NativeAdapter } from "../contracts.js";
import { analyzeDefinitions } from "./ruby/definitions.js";
import { emit } from "./ruby/emit.js";
import { parse, packageSources, type ParsedFile } from "./ruby/source.js";
import { workerPrograms } from "./ruby/workers.js";

const instanceInputs = new WeakMap<AnalysisResult, ReadonlySet<string>>();

export const rubyAdapter: NativeAdapter = {
  language: "ruby",
  async analyze(context) {
    const analysis: AnalysisResult = { definitions: [], diagnostics: [], workers: [] };
    instanceInputs.set(analysis, new Set());
    let parsed: ParsedFile[];
    try {
      parsed = await parse(context);
    } catch (error) {
      analysis.diagnostics.push({
        code: "ruby.parser-unavailable",
        severity: "error",
        message: `Ruby Ripper analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return analysis;
    }
    const { files, ownsSource } = packageSources(context, parsed, analysis.diagnostics);
    const definitions = analyzeDefinitions(context, files);
    analysis.definitions = definitions.definitions;
    analysis.diagnostics.push(...definitions.diagnostics);
    instanceInputs.set(analysis, definitions.requiredInstances);
    const workers = await workerPrograms({
      context,
      files,
      definitions: analysis.definitions,
      resolveName: definitions.resolveName,
      ownsSource,
    });
    analysis.workers = workers.workers;
    analysis.diagnostics.push(...workers.diagnostics);
    return analysis;
  },
  async emit(context) {
    const requiredInputs = instanceInputs.get(context.analysis);
    if (!requiredInputs) throw new Error("Ruby emission requires its native analysis result.");
    return emit(context, requiredInputs);
  },
};
