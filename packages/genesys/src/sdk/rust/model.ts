import type { Diagnostic } from "../../contracts.js";

export type RustDefinition = {
  path: string;
  line: number;
  kind: "workflow" | "activity";
  symbol: string;
  name: string | null;
  target: string;
  module: string;
  implementer: string;
  factory: boolean;
  eligible: boolean;
};
export type RustAnalysis = {
  packageName: string | null;
  definitions: RustDefinition[];
  diagnostics: { code: string; severity: Diagnostic["severity"]; path: string; message: string }[];
  targets: { name: string; path: string; kind: "lib" | "bin"; requiredFeatures: string[] }[];
  sdk: string | null;
};
