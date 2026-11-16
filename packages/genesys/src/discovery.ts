import { readdir, readFile, realpath, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Diagnostic,
  DiscoveryResult,
  Language,
  PackageContext,
  SourceEntry,
  SourceRole,
} from "./contracts.js";

const excludedDirectories = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "__pycache__",
  "venv",
  "site-packages",
  "coverage",
  "test",
  "tests",
  "__tests__",
  "spec",
  "__mocks__",
]);
const extensions: Record<string, Language> = {
  ".go": "go",
  ".java": "java",
  ".kt": "java",
  ".cs": "dotnet",
  ".fs": "dotnet",
  ".vb": "dotnet",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
};
const manifestNames: Record<string, Language> = {
  "go.mod": "go",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "java",
  "composer.json": "php",
  "pyproject.toml": "python",
  "setup.py": "python",
  "setup.cfg": "python",
  "requirements.txt": "python",
  Pipfile: "python",
  Gemfile: "ruby",
  "Cargo.toml": "rust",
  "package.json": "typescript",
};
const roleNames: Record<string, SourceRole> = {
  workflows: "workflow",
  activities: "activity",
  nexus: "nexus",
  workers: "worker",
};
const packageInputs = new Set([
  "go.sum",
  "go.work",
  "go.work.sum",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "gradle.lockfile",
  "global.json",
  "NuGet.Config",
]);

function packageLanguage(name: string): Language | undefined {
  if (/\.(csproj|fsproj|vbproj)$/.test(name)) return "dotnet";
  if (name.endsWith(".gemspec")) return "ruby";
  return manifestNames[name];
}

function isTest(name: string): boolean {
  return /(?:_test\.go|(?:[._](?:test|spec))\.[^.]+|\.d\.[cm]?ts|(?:Test|Tests|TestCase)\.(?:java|kt|cs|fs|vb|php)|_spec\.rb|_test\.rb|^test_.*\.py|.*_test\.py|\.(?:g|g\.i|designer)\.cs)$/.test(
    name,
  );
}

function within(path: string, root: string): boolean {
  return root === "." || path.startsWith(`${root}/`);
}

function sourceRole(
  path: string,
): Pick<SourceEntry, "discoveryRoot" | "role" | "workerName" | "workerDirectory"> | undefined {
  const parts = path.split("/");
  const rootIndex = parts.lastIndexOf("temporal");
  if (rootIndex < 0) {
    const workerIndex = parts.indexOf("workers");
    if (workerIndex < 0 || parts.slice(workerIndex + 1, -1).includes("lib")) return;
    return {
      discoveryRoot: parts.slice(0, workerIndex + 1).join("/"),
      role: "worker",
      ...(parts.length > workerIndex + 2
        ? {
            workerName: parts[workerIndex + 1],
            workerDirectory: parts.slice(0, workerIndex + 2).join("/"),
          }
        : {}),
    };
  }
  const tail = parts.slice(rootIndex + 1, -1);
  if (tail.includes("lib")) return;
  const roleIndex = tail.findIndex((part) => Object.hasOwn(roleNames, part));
  if (roleIndex < 0) return;
  const role = roleNames[tail[roleIndex]!]!;
  const discoveryRoot = parts.slice(0, rootIndex + 1).join("/");
  return {
    discoveryRoot,
    role,
    ...(role === "worker" && tail[roleIndex + 1]
      ? {
          workerName: tail[roleIndex + 1],
          workerDirectory: parts.slice(0, rootIndex + roleIndex + 3).join("/"),
        }
      : {}),
  };
}

/** Reads files only. Does not import source, evaluate package scripts, or invoke tools. */
export async function discoverProject(projectPath: string): Promise<DiscoveryResult> {
  const projectRoot = await realpath(resolve(projectPath));
  if (!(await lstat(projectRoot)).isDirectory())
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  const diagnostics: Diagnostic[] = [];
  const sources = new Map<string, string>();
  const packages = new Map<string, PackageContext>();
  const candidates: SourceEntry[] = [];

  async function walk(
    directory: string,
    inheritedLanguages: ReadonlySet<Language> = new Set(),
  ): Promise<void> {
    const children = await readdir(join(projectRoot, directory), { withFileTypes: true });
    const contextLanguages = new Set(inheritedLanguages);
    for (const child of children) {
      const language = child.isFile() ? packageLanguage(child.name) : undefined;
      if (language) contextLanguages.add(language);
    }
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      if (child.name.startsWith(".") && ![".rr.yaml", ".rr.yml"].includes(child.name)) continue;
      const path = directory === "." ? child.name : `${directory}/${child.name}`;
      if (child.isSymbolicLink()) {
        diagnostics.push({
          code: "source.symlink-skipped",
          severity: "info",
          source: { path },
          message: "Symbolic links are not followed during static inventory.",
        });
        continue;
      }
      if (child.isDirectory()) {
        const nativeOutput =
          (contextLanguages.has("dotnet") && ["bin", "obj"].includes(child.name)) ||
          (child.name === "build" &&
            ["java", "python", "typescript"].some((language) =>
              contextLanguages.has(language as Language),
            ));
        if (!excludedDirectories.has(child.name.toLowerCase()) && !nativeOutput)
          await walk(path, contextLanguages);
        continue;
      }
      if (!child.isFile() || isTest(child.name)) continue;
      let language = extensions[extname(child.name)];
      const manifestLanguage = packageLanguage(child.name);
      const packageInput =
        packageInputs.has(child.name) ||
        [".rr.yaml", ".rr.yml"].includes(child.name) ||
        /^tsconfig.*\.json$/.test(child.name) ||
        /\.(props|targets|sln|slnx)$/.test(child.name);
      const rubyExecutableLocation =
        contextLanguages.has("ruby") &&
        (["bin", "exe"].includes(directory.split("/").at(-1) ?? "") ||
          sourceRole(path)?.role === "worker");
      const extensionlessRubyCandidate = rubyExecutableLocation && extname(child.name) === "";
      if (!language && !manifestLanguage && !packageInput && !extensionlessRubyCandidate) continue;
      const content = await readFile(join(projectRoot, path), "utf8");
      if (extensionlessRubyCandidate && /^#![^\n]*\bruby\b/.test(content)) language = "ruby";
      if (!language && !manifestLanguage && !packageInput) continue;
      if (
        content.split("\n", 1)[0]?.includes("Code generated by Genesys") ||
        (language === "go" && /^\/\/ Code generated .* DO NOT EDIT\./m.test(content))
      )
        continue;
      sources.set(path, content);
      if (manifestLanguage) {
        const id = `${manifestLanguage}:${directory}`;
        const context = packages.get(id) ?? {
          id,
          language: manifestLanguage,
          root: directory,
          manifests: [],
        };
        context.manifests.push(path);
        packages.set(id, context);
        if (child.name.endsWith(".json")) {
          try {
            const parsed: unknown = JSON.parse(content);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error("Expected a JSON object");
          } catch (error) {
            diagnostics.push({
              code: "package.invalid-manifest",
              severity: "error",
              source: { path },
              message: `Cannot read package context: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
      const role =
        sourceRole(path) ??
        (rubyExecutableLocation && language === "ruby"
          ? {
              discoveryRoot: directory,
              role: "worker" as const,
              workerName: child.name.replace(/\.rb$/, ""),
            }
          : undefined);
      if (
        language === "python" &&
        child.name === "__init__.py" &&
        role?.role === "worker" &&
        !role.workerName
      )
        continue;
      if (language && role) candidates.push({ id: path, path, language, ...role });
    }
  }

  await walk(".");
  const entries: SourceEntry[] = [];
  const usedPackages = new Map<string, PackageContext>();
  for (const entry of candidates) {
    const contexts = [...packages.values()].filter(
      (context) => context.language === entry.language && within(entry.path, context.root),
    );
    contexts.sort((a, b) => b.root.length - a.root.length);
    const context = contexts[0];
    if (!context) {
      diagnostics.push({
        code: "package.missing-context",
        severity: "error",
        source: { path: entry.path },
        message: `No native ${entry.language} package manifest contains this source. Its package context is unresolved.`,
      });
    } else {
      entry.packageId = context.id;
      usedPackages.set(context.id, context);
      if (!within(entry.discoveryRoot, context.root) && entry.discoveryRoot !== context.root) {
        diagnostics.push({
          code: "package.discovery-root-outside-package",
          severity: "warning",
          source: { path: entry.path },
          message:
            "The temporal discovery root is outside the nearest package boundary. Native source inclusion needs SDK analysis.",
        });
      }
    }
    if (entry.role === "worker" && !entry.workerName) {
      diagnostics.push({
        code: "worker.missing-name",
        severity: "error",
        source: { path: entry.path },
        message: "Worker source must be inside a named directory under workers.",
      });
    }
    entries.push(entry);
  }

  for (const context of usedPackages.values()) {
    const projectFiles = context.manifests.filter((path) => /\.(csproj|fsproj|vbproj)$/.test(path));
    if (projectFiles.length > 1)
      diagnostics.push({
        code: "package.ambiguous-context",
        severity: "warning",
        source: { path: context.root },
        related: projectFiles.map((path) => ({ path })),
        message:
          "Multiple native project files share this directory. SDK analysis must resolve source inclusion; inventory does not select a project.",
      });
    diagnostics.push({
      code: "analysis.source-inventory-only",
      severity: "info",
      source: { path: context.root },
      message: `Recorded ${context.language} source roles and package files. Definition identities, native source inclusion, SDK versions, registration, and Worker entrypoints have not been analyzed.`,
    });
  }
  diagnostics.sort((a, b) =>
    `${a.source?.path ?? ""}:${a.code}:${a.message}`.localeCompare(
      `${b.source?.path ?? ""}:${b.code}:${b.message}`,
      "en",
    ),
  );
  return {
    projectRoot,
    manifest: {
      schemaVersion: 1,
      packages: [...usedPackages.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      entries,
      definitions: [],
      analysis: "source-inventory",
    },
    diagnostics,
    sources,
  };
}

/** The reserved .gsys tree contains generated files only. Refuse symlink destinations. */
export async function writeDiscovery(result: DiscoveryResult): Promise<void> {
  let directory = result.projectRoot;
  for (const segment of [".gsys", "discovery"]) {
    directory = join(directory, segment);
    try {
      await mkdir(directory);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Generated directory must be a real directory: ${directory}`);
  }
  for (const [name, data] of [
    ["manifest.json", result.manifest],
    ["diagnostics.json", result.diagnostics],
  ] as const) {
    const destination = join(directory, name);
    const temporary = join(dirname(destination), `.${name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
