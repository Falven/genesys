import type { Definition, SourceEntry } from "../../contracts.js";

export interface Expression {
  literal?: string;
  reference?: string;
  className?: string;
  concat?: Expression[];
}
export interface Annotation {
  name: string;
  values: Record<string, Expression>;
}
export interface Method {
  name: string;
  flags: string[];
  annotations: Annotation[];
  parameters: string[];
  returns: string;
  throwsTypes: string[];
}
export interface JavaType {
  name: string;
  simple: string;
  packageName: string;
  path: string;
  line: number;
  flags: string[];
  accessible: boolean;
  nested: boolean;
  kind: string;
  parents: string[];
  generic: boolean;
  annotations: Annotation[];
  imports: string[];
  staticImports: string[];
  methods: Method[];
  constants: Record<string, Expression>;
}
export interface Parsed {
  maven?: {
    properties: Record<string, string>;
    outputDirectory: string;
    parent: boolean;
    profiles: boolean;
    packaging: string;
  };
  types: JavaType[];
  diagnostics: { message: string; path: string; line: number; error: boolean }[];
}
export interface Registration {
  type: JavaType;
  kind: Definition["kind"];
  entry: SourceEntry;
}

export const location = (type: JavaType) => ({ path: type.path, line: type.line });
