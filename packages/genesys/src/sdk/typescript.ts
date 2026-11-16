import type { AnalysisContext, AnalysisResult, Diagnostic, NativeAdapter } from "../contracts.js";
import { registrationCollisions } from "./registration.js";
import { compilerModels, sdkVersionDiagnostic } from "./typescript/compiler.js";
import { exportedDefinitions } from "./typescript/definitions.js";
import { messageHandlers } from "./typescript/message-handlers.js";
import { nativeRegistrations } from "./typescript/native-registration.js";
import { workerPrograms } from "./typescript/workers.js";

import { emit } from "./typescript/emission.js";

async function analyze(context: AnalysisContext): Promise<AnalysisResult> {
  const diagnostics: Diagnostic[] = [];
  const { models, byConfig } = compilerModels(context, diagnostics);
  const handlers = messageHandlers(context, byConfig.values(), diagnostics);
  diagnostics.push(sdkVersionDiagnostic(context, byConfig.values()));
  const { definitions, nativeAssembly } = nativeRegistrations({
    context,
    configurations: byConfig.values(),
    models,
    diagnostics,
  });
  definitions.push(
    ...exportedDefinitions({
      context,
      models,
      messageHandlers: handlers,
      nativeAssembly,
      diagnostics,
    }),
  );
  const collisions = registrationCollisions(definitions, (definition) =>
    definition.registrationScope && definition.identity.name
      ? `${definition.registrationScope}:${definition.kind}:${definition.identity.name}`
      : undefined,
  );
  for (const { definition, previous } of collisions) {
    diagnostics.push({
      code: "typescript.native-registration-collision",
      severity: "error",
      source: definition.source,
      related: [previous.source],
      message: `Native ${definition.kind} identity ${definition.identity.name} is repeated in the same Worker registration scope.`,
    });
  }
  const workers = workerPrograms(context, models, diagnostics);
  const uniqueDiagnostics = [
    ...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).values(),
  ];
  return { definitions, diagnostics: uniqueDiagnostics, workers };
}

export const typescriptAdapter: NativeAdapter = { language: "typescript", analyze, emit };
