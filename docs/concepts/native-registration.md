---
title: "Native Registration"
description: "Use generated registration with your application's native Temporal SDK assembly."
---

Genesys generates native registration from discovered definitions. Your application uses the
Temporal SDK to connect to Temporal, construct dependencies, set Task Queues, choose which
definitions to register with each Worker, and start and stop its Workers.

## Follow the source through a build

1. Genesys inventories entries and assigns each one to a native package context.
2. SDK analysis resolves definitions, registration identities, and Worker entrypoints where
   the source provides enough evidence.
3. Genesys emits registration into an isolated build. The generated files follow the native
   package's import and visibility rules and use the native SDK's registration interfaces.
4. Your Worker program calls the generated registration where it needs those definitions.
   The native build tool checks the resulting program.

The generated file locations and interfaces depend on the language. A build's manifest records
the emitted files. For example, the Go adapter emits package-local registration helpers and a
`gsysregistration` package for each discovery root. See the [Go reference](../reference/sdk/go.md) for the
exact interfaces.

## Register definitions in your Worker

For the Go example, call the aggregate registration after creating a Worker through the native SDK.

```go
w := worker.New(c, "greetings", worker.Options{})
gsysregistration.Register(w)
```

The application passes its registry to the generated code. Some generated functions also accept
an Activity instance or a Nexus service that the application already constructed. Keep the
configuration, constructor arguments, and credentials in your native assembly.

Directory layout and language do not determine Worker grouping, Task Queues, or execution order.
For applications with several Workers, use the registration functions that match the native
scope of each Worker. Register each definition once per scope when combining generated and
explicit registration.

## Use explicit native assembly when needed

Some definitions or registration scopes depend on values that a static analyzer cannot resolve.
For example, a Workflow name can come from runtime configuration. Read the source-linked
diagnostics and the [SDK support matrix](../reference/sdk/index.md) to check what Genesys can resolve.
Use the native SDK's explicit registration APIs for forms that need application code at runtime.

A native registration identity is the name callers use. If a caller and Worker use different
SDK languages, both sides must agree on the identity and payload format. For details, see
[Mixed-Language Projects](../guides/mixed-language-projects.md).

## Next steps

See where to put source in [Project Structure](project-structure.md). Follow [Getting
Started](../getting-started.md) to generate registration, build the Worker, and start a Workflow.
