import { fileURLToPath } from "node:url";
import { posix } from "node:path";
import type { AnalysisContext, Diagnostic } from "../../contracts.js";
import { runTool } from "../tooling.js";

type Node = unknown[];
export interface Invocation {
  name: string;
  args: Node[];
  line: number;
}
export interface RubyClass {
  symbol: string;
  parent?: string;
  namespace: string[];
  path: string;
  line: number;
  calls: Invocation[];
  conditional: boolean;
  uncertain: boolean;
  initializer: boolean;
  required: boolean;
}
interface Assignment {
  symbol: string;
  value: Node;
  namespace: string[];
  path: string;
  line: number;
  conditional: boolean;
}
export interface ParsedFile {
  path: string;
  error?: string;
  classes: RubyClass[];
  assignments: Assignment[];
  workers: { path: string; line: number; options: Record<string, Node>; namespace: string[] }[];
  runs: number[];
  relative_requires: string[];
  private_constants: string[];
  diagnostics: Diagnostic[];
}

export const token = (node: unknown): Node => (Array.isArray(node) ? node : []);
export function constant(value: unknown): string | undefined {
  const node = token(value);
  switch (node[0]) {
    case "@const":
      return String(node[1]);
    case "var_ref":
    case "const_ref":
    case "var_field":
      return constant(node[1]);
    case "top_const_ref":
    case "top_const_field":
      return `::${constant(node[1])}`;
    case "const_path_ref":
    case "const_path_field": {
      const left = constant(node[1]);
      return left ? `${left}::${constant(node[2])}` : undefined;
    }
    default:
      return undefined;
  }
}

export function literal(value: unknown): { known: boolean; value?: string | boolean | null } {
  const node = token(value);
  if (node[0] === "var_ref") {
    const word = token(node[1])[1];
    if (word === "true" || word === "false" || word === "nil")
      return { known: true, value: word === "nil" ? null : word === "true" };
  }
  if (node[0] === "symbol_literal") {
    const leaf = token(token(node[1])[1]);
    if (["@ident", "@const", "@op"].includes(String(leaf[0])))
      return { known: true, value: String(leaf[1]) };
  }
  if (node[0] === "string_literal" || node[0] === "dyna_symbol") {
    const parts = token(node[1]).slice(1).map(token);
    if (parts.every((part) => part[0] === "@tstring_content")) {
      const text = parts.map((part) => part[1]).join("");
      if (!text.includes("\\")) return { known: true, value: text };
    }
  }
  return { known: false };
}

export function invocation(
  value: unknown,
): { receiver?: string; name?: string; args: Node[] } | undefined {
  const node = token(value);
  if (node[0] === "method_add_block") return invocation(node[1]);
  if (node[0] === "method_add_arg") {
    const result = invocation(node[1]);
    let args = token(node[2]);
    if (args[0] === "arg_paren") args = token(args[1]);
    return (
      result && { ...result, args: args[0] === "args_add_block" ? token(args[1]).map(token) : [] }
    );
  }
  if (node[0] === "call" || node[0] === "command_call")
    return {
      receiver: constant(node[1]),
      name: String(token(node[3])[1]),
      args: node[0] === "command_call" ? token(token(node[4])[1]).map(token) : [],
    };
  return undefined;
}

export function keywords(args: Node[]): Record<string, Node> {
  const hash = args.find((arg) => arg[0] === "bare_assoc_hash" || arg[0] === "hash");
  if (!hash) return {};
  const pairs = token(hash[0] === "hash" ? token(hash[1])[1] : hash[1]);
  return Object.fromEntries(
    pairs
      .map(token)
      .filter((pair) => pair[0] === "assoc_new" && token(pair[1])[0] === "@label")
      .map((pair) => [String(token(pair[1])[1]).replace(/:$/, ""), token(pair[2])]),
  );
}

const helper = fileURLToPath(new URL("../../../sdk/ruby/discover.rb", import.meta.url));
export async function parse(context: AnalysisContext): Promise<ParsedFile[]> {
  const sources = [...context.sources].filter(
    ([path, source]) => path.endsWith(".rb") || /^#![^\n]*\bruby\b/.test(source),
  );
  const env = { ...process.env };
  delete env.RUBYOPT;
  delete env.RUBYLIB;
  const output = await runTool({
    executable: "ruby",
    args: ["--disable=gems", helper],
    env,
    input: JSON.stringify({ sources }),
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return (JSON.parse(output) as { files: ParsedFile[] }).files;
}

const inside = (path: string, root: string) => root === "." || path.startsWith(`${root}/`);

export function packageSources(
  context: AnalysisContext,
  parsed: ParsedFile[],
  diagnostics: Diagnostic[],
) {
  let files = parsed;
  const nestedPackages = [...context.sources.keys()]
    .filter(
      (path) =>
        inside(path, context.package.root) &&
        posix.dirname(path) !== context.package.root &&
        (posix.basename(path) === "Gemfile" || path.endsWith(".gemspec")),
    )
    .map(posix.dirname);
  const ownsSource = (path: string) =>
    inside(path, context.package.root) && !nestedPackages.some((root) => inside(path, root));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set(files.filter((file) => ownsSource(file.path)).map((file) => file.path));
  for (const path of included) {
    for (const imported of byPath.get(path)?.relative_requires ?? []) {
      const target = posix.normalize(posix.join(posix.dirname(path), imported));
      const resolved = byPath.has(target) ? target : `${target}.rb`;
      if (byPath.has(resolved)) included.add(resolved);
      else
        diagnostics.push({
          code: "ruby.relative-import-unresolved",
          severity: "warning",
          source: { path },
          message: `require_relative ${JSON.stringify(imported)} is outside the static source inventory. Native loading remains authoritative.`,
        });
    }
  }
  files = files.filter((file) => included.has(file.path));
  for (const file of files) {
    if (file.error)
      diagnostics.push({
        code: "ruby.syntax",
        severity: "error",
        source: { path: file.path },
        message: file.error,
      });
    else diagnostics.push(...file.diagnostics);
  }
  files = files.filter((file) => !file.error);
  return { files, ownsSource };
}
