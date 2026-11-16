# TypeScript native registration

Genesys uses the TypeScript compiler API to read exports, aliases, re-exports, callable types, package imports, and native Worker assembly. Discovery does not import application modules or call factories. The analyzer uses the separate `typescript-compiler` dependency (TypeScript 6.0.3); TypeScript 7's npm entry does not expose this compiler API. Application builds continue to use their installed compiler and build settings.

The nearest `tsconfig.json` supplies source inclusion, project paths, module resolution, and output paths. Without that file, static analysis uses NodeNext resolution and reports the assumption. Dependencies must be installed for complete type and module resolution. Unsupported compiler syntax or configuration is a tooling limit, not a Temporal SDK limitation. Native builds remain authoritative for semantic validity.

## Definitions and native ownership

Each exported callable in `temporal/workflows/` is a Workflow entry. The export name is its native identity, including aliases from re-exports. A callable `default` export remains Temporal's fallback Workflow; it has no single fixed identity. Signal, Query, Update and validator definitions remain inside the authored module and are not extracted as new Workflows.

`temporal/activities/` can export several callable functions or an existing object whose properties contain Activity functions. Mapping keys are native Activity names. Generated code reads the existing function values; it does not instantiate a class, call a factory, or bind a receiver on the author's behalf. Bound functions and closures retain their authored dependencies. A class alone produces a construction diagnostic because the Worker must supply its existing instance and appropriate bound functions.

The analyzer also reads recognized `Worker.create` calls, including aliased SDK imports. Literal and constant Activity maps, object spreads, methods, and typed factory results supply names within that exact Worker registration scope. Mapping overrides use JavaScript's last-property-wins behavior. Factory use through native `activities` assembly suppresses treating that factory itself as an automatic Activity export. Application factories, closures and receiver bindings stay in the native Worker program. Unknown keys, computed options, and dynamic construction produce diagnostics; inspection does not claim complete registration coverage.

For `workflowsPath`, static `require.resolve(...)` and `fileURLToPath(new URL(..., import.meta.url))` forms resolve through package context. Their actual exported functions establish a Worker-local registration scope. Prebuilt `workflowBundle` objects remain authored native assembly. Genesys does not reverse engineer generated bundle code or replace bundle settings.

Nexus discovery recognizes exported `nexus-rpc` `serviceHandler(service, handlers)` values and existing `ServiceHandler` instances. Native service contracts supply service identities. The current `service(name, operations)` API and legacy `defineService` contract shape are recognized. Operation membership, operation name overrides, converters and handler implementations stay in the native service object. Dynamic service factories and array spreads remain explicit native assembly with an incomplete-coverage diagnostic.

## Generated files

For each discovery root, generation writes ordinary source files beside the source layout:

- `temporal/genesys-workflows.ts`: named Workflow re-exports only.
- `temporal/genesys-activities.ts`: an exported `activities` object.
- `temporal/genesys-nexus.ts`: an exported `nexusServices` array.

A collection containing `.mts` or `.mjs` entries uses `.mts`. The generated marker identifies owned files. The compile manifest records these locations outside `.gsys`; placement keeps native `rootDir`, relative imports and compiler outputs aligned. Applications with explicit `files` lists must include the generated modules through native imports or their existing native build settings.

A native Worker can consume the generated values directly:

```ts
import { Worker } from "@temporalio/worker";
import { activities } from "../../temporal/genesys-activities.js";
import { nexusServices } from "../../temporal/genesys-nexus.js";

const worker = await Worker.create({
  taskQueue: "application-owned-queue",
  workflowsPath: require.resolve("../../temporal/genesys-workflows"),
  activities,
  nexusServices,
});
await worker.run();
```

Use the package's native ESM path construction in an ESM Worker. The example shows native options, not a required startup script. Connections, Task Queues, instances, factories, interceptors, converters, bundling and shutdown stay application-owned. Applications can compose generated values with explicit native registration.

Workflow generation never imports the Activity or Nexus registration module. Static ESM runtime imports from Workflow code into discovered Activity, Nexus or Worker implementations produce an error; type-only imports are allowed. The native Workflow bundler still enforces its sandbox and resolves other dependencies. For `.mts`/`.mjs` layouts, bundle the compiler's emitted JavaScript or use the application's existing native bundler configuration.

Re-exporting the same implementation under the same identity is deduplicated. If independent files expose the same identity, the aggregate is omitted with a diagnostic. This does not declare a cross-Worker collision: independent native registration scopes can reuse identities. Repeated Nexus identities inside one recognized Worker scope are errors. JavaScript Activity-map overrides retain their native last-write behavior.

## Native Worker programs

Named `workers/<name>/` directories supply Worker candidates. The adapter prefers a package `main` or `bin` declaration that maps to a source or its native compiler output. Otherwise it considers top-level executable call sites. More than one candidate, or no candidate, produces an ambiguity diagnostic and no guessed startup command.

`gsys dev` uses an existing native `build` script through npm, pnpm, Yarn or Bun. Without a script, it falls back to the package's installed compiler and an emitting tsconfig. A native startup override is available for development programs that require a custom bundler or source loader.

## Production output

`gsys build` runs the application's installed `node_modules/typescript/bin/tsc` directly with `--build --force` and the native `tsconfig.json`. It runs after registration generation. Compiler settings such as `rootDir`, `outDir`, module format and project references control the JavaScript output. Keep the compiler, referenced project configs, and emitted files inside the selected workspace. A JavaScript entrypoint can run directly from the snapshot when its config does not emit it. If an entrypoint names a compiled registration file in a path literal, Genesys runs the registration's emitting config and checks for the expected file. Configure any additional compilation for computed registration paths in the enclosing native task. A TypeScript entrypoint without supported JavaScript output fails the build with a source diagnostic.

Install the application's dependencies first with its native package manager. The build copies the installed dependency trees and authored assets into the snapshot. It records the discovered `node_modules` locations, the entrypoint output paths, and the declared Node.js requirement when present. The installed trees can include development dependencies and platform-specific native modules. Provide Node.js and any native libraries those dependencies require on the deployment host. Keep `package.json`, the installed modules, and the files the application reads in their native relative layout.

An enclosing package task can call `gsys build` and then run asset preparation, bundling, or distribution steps of its own. Genesys invokes the compiler directly in production, so a call through another package task or lifecycle script cannot call back into the enclosing task. Projects that rely on a bundler to emit their TypeScript need an emitting tsconfig for this build command. Include generated registration in the native config when the application loads it by filename, as with `workflowsPath`.

For a package with `rootDir: "."`, `outDir: "dist"`, and `workers/orders/index.ts`, install the dependencies and build from the package directory. Then use the build's immutable `root` and the `workers[].start` entry to launch Node directly. For example, run the recorded equivalent of these commands, with the build ID in `build_id`:

```sh
npm ci
gsys build .
cd ".gsys/compile/builds/$build_id/project"
node dist/workers/orders/index.js
```

Use the recorded arguments and working directory when the build selects a different entrypoint or package directory. Supply Temporal connection settings and credentials at startup. Publication establishes that compilation and output recording completed. Polling and deployment compatibility require runtime evidence.

Build and start paths are relative to the isolated project/package, so each process uses its corresponding versioned build. The adapter does not set Temporal Build IDs or Worker deployment routing.

Worker process startup and `RUNNING` are not polling evidence. Readiness remains unavailable until the supervisor can attribute fresh native Worker heartbeats and successful polls to the owned process generation. Dynamic Worker instance coverage remains unknown. Server deployment drainage is a separate retirement condition; local `DRAINED` state is not deployment drainage.

## Release evidence and validation limits

Reviewed on 2026-11-16 against released `@temporalio/worker` **1.25.0** and `nexus-rpc` **0.0.3**, including their published source:

- [Worker registration options and native Activity/Nexus map compilation](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/worker/src/worker-options.ts).
- [Workflow bundle export lookup and default fallback](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/workflow/src/worker-interface.ts).
- [Workflow bundler and extension resolution](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/worker/src/workflow/bundler.ts).
- [Published nexus-rpc 0.0.3 package](https://www.npmjs.com/package/nexus-rpc/v/0.0.3).
- [Native Nexus handler guide](https://docs.temporal.io/develop/typescript/nexus/feature-guide).

Inspection reports the declared Worker dependency and installed version when resolvable. Source review does not establish runtime compatibility with older SDK releases.

Native `setHandler` references and Update validator references are excluded from
automatic Workflow exports. Const aliases and re-exports resolve through the
compiler. Dynamic references receive source-linked diagnostics; explicit native
Workflow bundle assembly remains available.
