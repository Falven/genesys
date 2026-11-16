---
title: "TypeScript SDK"
description: "Discover native TypeScript definitions, use generated registration, and build JavaScript for Node.js."
---

Use your native Temporal Worker and TypeScript package settings. Genesys reads exports and recognized Worker registration through the TypeScript compiler API. Your application supplies connections, Task Queues, interceptors, converters, dependency construction, and shutdown.

Install the project's native dependencies before inspection or builds. Genesys uses the nearest `tsconfig.json` for source inclusion, paths, and module resolution. Without a config, inspection uses NodeNext resolution and reports that assumption. The analyzer uses `typescript-compiler` (TypeScript **6.0.3**) without importing application modules or calling factories. The production build uses the application's installed compiler. The released API review covered [Temporal Worker 1.25.0](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/worker/src/worker-options.ts) and [nexus-rpc 0.0.3](https://www.npmjs.com/package/nexus-rpc/v/0.0.3).

## Place and export definitions

| Directory or native option | Recognized form                                                                                       | Native identity                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `temporal/workflows/`      | Callable exports, aliases, and re-exports                                                             | The export name, with `default` for the native fallback |
| `temporal/activities/`     | Callable exports and exported object maps                                                             | The export name or map key                              |
| `temporal/nexus/`          | `serviceHandler(service, handlers)` values and existing `ServiceHandler` instances                    | Service contract name when resolved                     |
| `Worker.create()`          | Resolvable `workflowsPath`, Activity maps, and Nexus service arrays, including aliased Worker imports | The names assigned in that Worker registration scope    |

A callable `default` Workflow export serves as the fallback for unmatched Workflow types. Recognized `setHandler` callbacks, including Signals, Queries, Updates, and validators, stay in the authored Workflow module. See the [SDK's fallback lookup](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/workflow/src/worker-interface.ts).

For existing native assembly, Genesys recognizes literal paths in `require.resolve(...)` and `fileURLToPath(new URL(..., import.meta.url))`. It reads Activity map literals, spreads, methods, and factory result types when keys resolve. A later map property replaces an earlier property with the same name. Factories passed through native `activities` assembly are excluded from automatic Activity exports. Pass existing bound functions and closures through the native mapping when they depend on a receiver or other application state.

Nexus service names can come from `service(name, operations)` or legacy `defineService` contracts. Operation membership, overrides, converters, and handlers stay in the native service object. Use explicit native assembly for prebuilt `workflowBundle` values, dynamic Worker options, unknown map keys, dynamic Nexus construction, and Nexus array spreads. Diagnostics identify incomplete coverage.

## Use generated registration

Inside the versioned build, Genesys writes one set of source modules per discovery root. For a `temporal/` root, use these paths:

| Generated file                   | Content                                              |
| -------------------------------- | ---------------------------------------------------- |
| `temporal/genesys-workflows.ts`  | Workflow re-exports, including a fallback when found |
| `temporal/genesys-activities.ts` | An `activities` object containing native functions   |
| `temporal/genesys-nexus.ts`      | A `nexusServices` array of existing handlers         |

A collection with `.mts` or `.mjs` source entries uses `.mts`, which emits `.mjs` under NodeNext. Include the generated sources in your native build. If you load a generated module by filename, include it in `tsconfig.json` even when no TypeScript import refers to it.

For example, use this layout in an ESM package:

```text
orders/
├── package.json
├── tsconfig.json
├── temporal/
│   ├── activities/order.ts
│   └── workflows/checkout.ts
└── workers/
    └── orders/index.ts
```

In `package.json`, set the module type and dependencies:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@temporalio/worker": "1.25.0"
  },
  "devDependencies": {
    "@types/node": "26.6.6",
    "typescript": "6.0.3"
  }
}
```

In `tsconfig.json`, include the authored and generated files:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["temporal", "workers"]
}
```

In `temporal/workflows/checkout.ts`, export a Workflow:

```ts
export async function checkout(orderId: string): Promise<string> {
  return orderId;
}
```

In `temporal/activities/order.ts`, export an Activity:

```ts
export async function formatOrder(orderId: string): Promise<string> {
  return `Order ${orderId}`;
}
```

In `workers/orders/index.ts`, register the generated Workflow and Activity collections with the native Worker:

```ts
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import { activities } from "../../temporal/genesys-activities.js";

const worker = await Worker.create({
  taskQueue: "orders",
  workflowsPath: fileURLToPath(new URL("../../temporal/genesys-workflows.js", import.meta.url)),
  activities,
});
await worker.run();
```

Build the example using the commands below. Before registration exists, analysis can warn that the generated Workflow path or Activity map cannot resolve. The build generates both files before running the application compiler.

Add the generated `nexusServices` value to `Worker.create()` when this Worker also serves Nexus requests. Set the application's native connection and Namespace options when using a Temporal service outside the SDK's defaults.

Workflow generation imports only Workflow modules. Resolved static ES runtime imports from a Workflow into discovered Activity, Nexus, or Worker implementations produce an error. Use type-only Activity imports and the SDK's Workflow proxies. Native bundling still resolves other dependencies and enforces the Workflow sandbox. See the [SDK Workflow bundler](https://github.com/temporalio/sdk-typescript/blob/v1.25.0/packages/worker/src/workflow/bundler.ts).

If distinct definitions share an identity within a generated collection, Genesys warns and omits the collection. Re-exports of the same implementation under the same name are deduplicated. Independent Workers can reuse identities. Duplicate Nexus identities within one recognized Worker scope are errors.

## Select a Worker entrypoint

Use a named directory such as `workers/orders/`. Genesys prefers a `package.json` `main` or `bin` entry that names the discovered source or its compiler output. Otherwise it looks for a top-level call or `await` expression. With zero or several candidates, Genesys reports ambiguity and leaves the startup command unresolved.

In development, `gsys dev` uses the package's `build` script through npm, pnpm, Yarn, or Bun. Without a supported script, it uses the installed compiler and an emitting config when available. Use the native Worker startup override for a custom bundler or source loader.

## Build and run JavaScript

Run `gsys build .` from the project root after installing dependencies. Genesys generates registration then invokes the installed `node_modules/typescript/bin/tsc` directly with `--build --force` and the native config. Keep compiler inputs, referenced configs, and output paths inside the selected project. The build skips package lifecycle scripts so an enclosing package task can call Genesys and then handle bundling, asset preparation, or distribution.

A TypeScript entrypoint must produce JavaScript. A `.js`, `.mjs`, or `.cjs` entrypoint can run directly from the snapshot when the config leaves it as source. If the entrypoint names a compiled registration file in a path literal that Genesys recognizes, the build runs its emitting config and checks for the file. For computed paths, configure additional compilation in the enclosing native task. JSX preserved by the compiler requires native tooling to run it.

Read `.gsys/compile/manifest.json`. In the selected `workers` record, `nativeOutput.paths` lists the entrypoint outputs and statically recognized compiled registration paths, relative to `root`. `nativeOutput.dependencies` lists the installed `node_modules` directories when present. `nativeOutput.runtimeRequirements` records Node.js and the package's declared version range when available.

With the layout above, `workers[].start` records Node.js, `dist/workers/orders/index.js`, and the versioned package directory. From the example package, install dependencies, build, and use `jq` to read the startup directory:

```sh
npm install
gsys build .
build_directory=$(jq -er '.workers[] | select(.name == "orders") | .start.cwd' .gsys/compile/manifest.json)
(cd "$build_directory" && node dist/workers/orders/index.js)
```

Use the recorded command when your build selects a different entrypoint or package directory. For deployment, keep `package.json`, installed modules, emitted JavaScript, and runtime assets in their native relative layout. The copied dependency trees can contain development dependencies and platform-specific native modules. Supply Node.js and any native libraries needed by the application. See [versioned builds](../../guides/builds.md) and [native deployment](../../guides/deployment.md).

## Validation

Earlier production builds verified direct compiler invocation, emitted registration for JavaScript and TypeScript entrypoints, project references within the selected project, and preservation of the previous build selector when an output path escaped the project. The evidence covers compilation, copied dependencies, and recorded output paths.

The example above built on macOS arm64 with Node.js 26.13.1. The published JavaScript Worker ran directly against a local Temporal server, and the `checkout` Workflow returned `"order-9"`.
