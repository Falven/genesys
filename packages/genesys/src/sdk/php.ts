import { posix } from "node:path";
import type { AnalysisResult, Diagnostic, NativeAdapter } from "../contracts.js";
import { analyzeDefinitions } from "./php/definitions.js";
import { workers } from "./php/workers.js";
import { emit } from "./php/registration.js";

export const phpAdapter: NativeAdapter = {
  language: "php",
  async analyze(context): Promise<AnalysisResult> {
    const diagnostics: Diagnostic[] = [];
    let version: string | undefined;
    try {
      const lock = context.sources.get(posix.join(context.package.root, "composer.lock"));
      if (lock)
        version = (
          JSON.parse(lock) as { packages?: { name: string; version: string }[] }
        ).packages?.find((pkg) => pkg.name === "temporal/sdk")?.version;
      const manifest = JSON.parse(
        context.sources.get(posix.join(context.package.root, "composer.json")) ?? "{}",
      ) as { require?: Record<string, string> };
      if (!manifest.require?.["temporal/sdk"])
        diagnostics.push({
          code: "php.sdk-dependency",
          severity: "warning",
          source: { path: posix.join(context.package.root, "composer.json") },
          message:
            "temporal/sdk is not a direct Composer runtime dependency; native package availability requires verification.",
        });
    } catch (error) {
      diagnostics.push({
        code: "php.composer-context",
        severity: "error",
        source: { path: context.package.root },
        message: `Invalid Composer metadata: ${String(error)}`,
      });
    }
    diagnostics.push({
      code: "php.sdk-version",
      severity: "info",
      source: { path: context.package.root },
      message: `Inspected temporal/sdk v2.20 (5180fcd24e8f08fd5955fde7b2eeeae3c018b2e5); Composer lock resolves ${version ?? "no exact SDK version"}. Other versions require native verification. Inspection uses php-parser 3.7.0 and does not execute PHP or Composer. Doctrine annotations and custom metadata readers require explicit native assembly.`,
    });
    const definitions = analyzeDefinitions(context, diagnostics);
    const programs = workers(context, diagnostics, definitions);
    return { definitions, diagnostics, workers: programs };
  },
  emit,
};
