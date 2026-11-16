import { cp, readFile, rm, writeFile } from "node:fs/promises";

const output = new URL("../dist/docs/", import.meta.url);
await rm(output, { recursive: true, force: true });
await cp(new URL("../../../docs/", import.meta.url), output, { recursive: true });
await cp(new URL("../../../GLOSSARY.md", import.meta.url), new URL("GLOSSARY.md", output));

const index = new URL("README.md", output);
const content = await readFile(index, "utf8");
await writeFile(index, content.replace("](../GLOSSARY.md)", "](GLOSSARY.md)"));
