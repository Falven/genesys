import type {
  AnalysisContext,
  AnalysisResult,
  EmissionResult,
  Language,
  NativeAdapter,
} from "../contracts.js";

interface PreparedAnalysis {
  analysis: AnalysisResult;
  emission: EmissionResult;
}

export function createAnalyzerAdapter({
  language,
  inspect,
}: {
  language: Language;
  inspect: (context: AnalysisContext) => Promise<PreparedAnalysis>;
}): NativeAdapter {
  const emissions = new WeakMap<AnalysisResult, EmissionResult>();
  return {
    language,
    async analyze(context) {
      const result = await inspect(context);
      emissions.set(result.analysis, result.emission);
      return result.analysis;
    },
    async emit(context) {
      const emission = emissions.get(context.analysis);
      if (!emission) throw new Error(`${language} emission requires its native analysis result.`);
      return emission;
    },
  };
}
