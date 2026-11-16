import { appendFileSync } from "node:fs";

if (process.env.GENESYS_TS_MARKER) appendFileSync(process.env.GENESYS_TS_MARKER, "build\n");
