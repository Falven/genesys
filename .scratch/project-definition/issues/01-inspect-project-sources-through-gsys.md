# 01: Inspect project sources through gsys

**What to build:** An installable CLI discovers source roles and native package context and writes inspectable source manifests without executing authored code.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**State:** resolved

- [x] Recognize all eight SDK languages from source and package context, including nested source layouts.
- [x] Recognize recursive Workflow, Activity, Nexus, and Worker source locations. Exclude helpers, native tests, dependencies, and generated output.
- [x] Record source entries independently from definitions. Do not infer execution order, queues, or Worker placement.
- [x] Report source diagnostics and unsupported or ambiguous package context accurately.
- [x] Establish the shared internal tooling contracts used by subsequent SDK tickets. Keep native execution configuration outside manifests.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

Implemented `@genesys/cli` with the `gsys inspect [project-directory]` executable.
Static inventory records eight language families, native package manifests, recursive
source roles, and independent named Worker directories. It does not import authored
code or invoke package scripts. Missing package contexts, invalid JSON package files,
ambiguous .NET project membership, and skipped symlinks have source-linked diagnostics.
The generated manifest reports `source-inventory` and an empty definition list;
native SDK analysis and exact source inclusion remain explicit work for tickets 02–09.

`src/contracts.ts` defines internal analysis, generation, native command, construction,
and readiness metadata contracts. Native output paths can reside outside `.gsys` in
the isolated build root. Commands are absent from discovery JSON. Package README
documents the contract, exclusion conventions, and inventory limits.

Verification: `pnpm install --ignore-scripts`, package `typecheck`, package `build`,
`pnpm exec oxfmt --check packages/genesys pnpm-workspace.yaml`, `git diff --check`, and
`pnpm --filter @genesys/cli pack --pack-destination /tmp/genesys-notes` passed.
Removed the unsupported workspace setting `lockfile.includeResolutionSettings` so
the pinned pnpm version can install; dependency pins remain unchanged.
No tests, test harnesses, assertion checks, application execution, or SDK compatibility
checks were added or run. This macOS environment has host Node 22.20.0; the published
package requires Node 24. Runtime/platform verification remains ticket 18 work.
