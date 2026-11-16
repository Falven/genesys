---
title: "SDK Adapter Maintenance"
description: "Maintain the internal boundaries for native analysis, generated artifacts, and Worker program plans."
---

The CLI uses `packages/genesys/src/contracts.ts` for internal SDK integration. Each module at
`packages/genesys/src/sdk/<language>.ts` exports a named `<language>Adapter` that implements
`NativeAdapter`. The language identifiers are `go`, `java`, `dotnet`, `php`, `python`, `ruby`,
`rust`, and `typescript`. Application authors use [native registration](../concepts/native-registration.md).

## Analyze source

`analyze` receives the package context, its entries, and the project's static source and package
file text. It returns definitions, diagnostics, and native Worker program plans. Keep analysis
and emission static. Source paths in records are slash-separated and relative to the absolute
`projectRoot`.

Keep definition identities and native scopes unresolved when static evidence is insufficient.
Keep Worker execution plans internal to the CLI. For readiness metadata, describe native evidence
or report checks as unavailable. Readiness requires evidence beyond process creation.

## Emit native artifacts

`emit` receives the context and analysis result and returns native artifacts and diagnostics.
Artifact paths are relative to the isolated build's project root. Place artifacts outside
`.gsys` when native import rules require that placement. The build publisher validates paths,
rejects collisions with authored files, and records each output before publication.

An adapter can emit native source and metadata alongside registration. Generated functions
can accept native objects or factories from the application when construction is required.
Record that requirement in `Definition.construction`. Keep construction and lifecycle
in the application through the native SDK. Exclude containers, application configuration formats,
required authored registration lists, and runtime wrappers from adapters.

## Record discovery

Discovery manifests use schema version 1 and contain package contexts, entries, and definitions.
Source inventory uses the `source-inventory` analysis level and an empty definitions list.
Keep the manifest independent of time and the absolute project path for stable output across
project locations.
