import { cp, mkdir } from "node:fs/promises";

const output = new URL("../dist/docs/", import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL("../../../docs/", import.meta.url), output, { recursive: true });
await cp(new URL("../../../GLOSSARY.md", import.meta.url), new URL("GLOSSARY.md", output));
