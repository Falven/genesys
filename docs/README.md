# Genesys Documentation

Genesys uses directory conventions to discover and register native Temporal definitions.
The npm package is `@genesys/cli`, and its executable is `gsys`.

## Find the page for your task

| To do this                                                  | Read this                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| Install the CLI and run a Go Worker                         | [Getting Started](getting-started.md)                        |
| Place source files and understand discovery                 | [Project Structure](concepts/project-structure.md)           |
| Register definitions through the native SDK                 | [Native Registration](concepts/native-registration.md)       |
| Inspect a project's entries, definitions, and Workers       | [Inspect](reference/cli/index.md#gsys-inspect)               |
| Start Workers, reuse a supervisor, and manage replacement   | [Development](guides/development.md)                         |
| Look up CLI commands, options, and output                   | [CLI](reference/cli/index.md)                                |
| Build a version and understand publication and retention    | [Versioned Builds](guides/builds.md)                         |
| Run a native build through Compose or a process manager     | [Native Worker Deployment](guides/deployment.md)             |
| Put multiple SDK languages in one project                   | [Mixed-Language Projects](guides/mixed-language-projects.md) |
| Choose an SDK and check registration forms and dependencies | [SDK Support](reference/sdk/index.md)                        |
| Check platform requirements and process ownership           | [Platform Support](reference/platforms.md)                   |

## Read this first

1. [Getting Started](getting-started.md)
2. [Project Structure](concepts/project-structure.md)
3. [Native Registration](concepts/native-registration.md)
4. [Development](guides/development.md)
5. [Versioned Builds](guides/builds.md)
6. [Native Worker Deployment](guides/deployment.md)
7. [Mixed-Language Projects](guides/mixed-language-projects.md)
8. [SDK Support](reference/sdk/index.md) and the reference for your language
9. [Platform Support](reference/platforms.md)
10. [CLI](reference/cli/index.md)

## How Genesys fits your application

- You author Workflows, Activities, and Nexus service handlers through your Temporal SDK.
- Genesys finds definitions in your source and generates native code that registers them.
- Your Worker programs connect to Temporal and choose their Task Queues, registration, and SDK
  options. Your application controls dependency construction and Worker lifecycle.
- The Genesys development supervisor builds and starts Worker programs in isolated versions.
  It manages the local Temporal server and starts replacements when source changes.

See the [glossary](../GLOSSARY.md) for project terms.
