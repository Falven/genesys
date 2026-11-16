#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { serve } = await import(pathToFileURL(resolve("probe-worker.mjs")));
await serve("alpha", "override");
