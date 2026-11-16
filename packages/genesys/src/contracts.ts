export const languages = [
  "go",
  "java",
  "dotnet",
  "php",
  "python",
  "ruby",
  "rust",
  "typescript",
] as const;
export type Language = (typeof languages)[number];
export type SourceRole = "workflow" | "activity" | "nexus" | "worker";

/** Paths in records are slash-separated and relative to projectRoot. */
export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source?: SourceLocation;
  related?: SourceLocation[];
}

export interface PackageContext {
  id: string;
  language: Language;
  root: string;
  manifests: string[];
}

export interface SourceEntry {
  id: string;
  path: string;
  discoveryRoot: string;
  role: SourceRole;
  language: Language;
  packageId?: string;
  workerName?: string;
  /** Actual recognized named Worker directory, including nested scope directories. */
  workerDirectory?: string;
}

export interface Definition {
  id: string;
  source: SourceLocation;
  entryId: string;
  language: Language;
  kind: "workflow" | "activity" | "nexus";
  symbol: string;
  identity: { name?: string; state: "resolved" | "dynamic" | "unresolved"; reason?: string };
  /** Only populate when native registration establishes this scope. */
  registrationScope?: string;
  /** Native type or callable whose existing instance/factory is needed. */
  construction?: { symbol: string; reason: string };
}

/** Internal execution plans, never application configuration or discovery JSON. */
export interface Command {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/** Build-derived native evidence; never authored application configuration. */
export interface GoWorkerCoverage {
  kind: "go-unversioned-single-worker";
  sourceSha256: string;
  executable: string;
  cwd: string;
  sha256: string;
  taskQueue: string;
  taskTypes: ("workflow" | "activity")[];
  sdkVersion: "1.51.0";
  platform: "darwin" | "linux";
  architecture: string;
}

export function isGoWorkerCoverage(value: unknown): value is GoWorkerCoverage {
  if (!value || typeof value !== "object") return false;
  return (
    "kind" in value &&
    value.kind === "go-unversioned-single-worker" &&
    "executable" in value &&
    typeof value.executable === "string" &&
    "cwd" in value &&
    typeof value.cwd === "string" &&
    "sourceSha256" in value &&
    typeof value.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sourceSha256) &&
    "sha256" in value &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    "taskQueue" in value &&
    typeof value.taskQueue === "string" &&
    value.taskQueue.length > 0 &&
    "taskTypes" in value &&
    Array.isArray(value.taskTypes) &&
    value.taskTypes[0] === "workflow" &&
    (value.taskTypes.length === 1 ||
      (value.taskTypes.length === 2 && value.taskTypes[1] === "activity")) &&
    "sdkVersion" in value &&
    value.sdkVersion === "1.51.0" &&
    "platform" in value &&
    (value.platform === "darwin" || value.platform === "linux") &&
    "architecture" in value &&
    typeof value.architecture === "string"
  );
}

/** Optional native build evidence. Paths are slash-separated and relative to the build root. */
export interface NativeOutput {
  paths?: string[];
  target?: { platform?: string; architecture?: string; runtime?: string };
  dependencies?: { path: string; kind: string }[];
  runtimeRequirements?: string[];
}

export interface WorkerProgram {
  id: string;
  name: string;
  language: Language;
  packageId: string;
  source: SourceLocation;
  /** Native package cwd, retained when no startup command can be inferred. */
  workingDirectory?: string;
  coverage?: GoWorkerCoverage;
  build?: Command[];
  start?: Command;
  nativeOutput?: NativeOutput;
  /** Metadata for the supervisor; unknown never authorizes replacement. */
  readiness: {
    state: "supported" | "unavailable";
    description: string;
    evidence?: string[];
  };
}

export interface AnalysisContext {
  projectRoot: string;
  package: PackageContext;
  mode?: "production";
  entries: readonly SourceEntry[];
  /** Static source and package file text keyed by project-relative path. */
  sources: ReadonlyMap<string, string>;
}

export interface AnalysisResult {
  definitions: Definition[];
  diagnostics: Diagnostic[];
  workers: WorkerProgram[];
}

export interface GeneratedArtifact {
  /** Relative to isolated project root; may be outside .gsys for native imports. */
  path: string;
  content: string;
  kind: "registration" | "source" | "metadata";
}

export interface EmitContext extends AnalysisContext {
  analysis: AnalysisResult;
}

export interface EmissionResult {
  artifacts: GeneratedArtifact[];
  diagnostics: Diagnostic[];
}

/** Internal SDK boundary. Analysis and emission must not execute authored code. */
export interface NativeAdapter {
  language: Language;
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
  emit(context: EmitContext): Promise<EmissionResult>;
}

export interface DiscoveryManifest {
  schemaVersion: 1;
  packages: PackageContext[];
  entries: SourceEntry[];
  definitions: Definition[];
  analysis: "source-inventory" | "native-analysis";
}

export interface DiscoveryResult {
  projectRoot: string;
  manifest: DiscoveryManifest;
  diagnostics: Diagnostic[];
  sources: ReadonlyMap<string, string>;
}
