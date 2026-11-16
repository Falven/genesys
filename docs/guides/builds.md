---
title: "Versioned Builds"
description: "Build native Worker applications, read their output records, and retain versions still in use."
---

Run `gsys build [project-directory]` to generate registration and produce native Worker output. The
command defaults to the current directory. It runs native build tools in an isolated snapshot and
publishes the build after all required steps succeed. [Inspection](../getting-started.md#inspect-the-project)
reads source and writes discovery records without running those build steps.

## Choose the build root

Pass the complete native workspace, including local dependencies and package settings. Each
invocation copies the project into `.gsys/compile/builds/<id>/project`. Genesys creates the version
directory with mode `0700` before copying, and each native command runs from a working directory
inside that snapshot. Registration generation writes to the snapshot.

- The snapshot copies regular files and installed dependencies such as `node_modules` and `vendor`.
  Native tools still control dependency resolution and installation.
- It retargets internal symbolic links and rejects links outside the project or into excluded
  directories. Native output links back to authored files or earlier builds also fail.
- It excludes `.git`, `.gsys`, Python virtual environments and bytecode caches, and source files
  marked with a Genesys generated header. Python builds create a fresh environment.
- Development builds also exclude explicitly forwarded Temporal database paths and their SQLite
  sidecars. `gsys build` does not infer runtime data locations.

Native build scripts can execute application code. The snapshot does not sandbox those scripts or
rewrite arbitrary absolute paths. Supply the toolchains and system libraries your native tools
require. Keep the completed snapshot at its original absolute path. Native launch records and
Python virtual environment scripts can depend on that path.

## Native output by SDK

Build steps and output depend on the native project. Check the SDK page for supported layouts,
dependency inputs, startup commands, and runtime requirements.

| SDK                                          | Output from supported builds                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Go](../reference/sdk/go.md)                 | Native executable for each selected main package, built with `go build` and the project's target settings                                      |
| [Java](../reference/sdk/java.md)             | Maven or Gradle classes, resources, and runtime classpath dependencies                                                                         |
| [.NET](../reference/sdk/dotnet.md)           | Framework-dependent C# DLL, runtime configuration, and files from `dotnet publish`                                                             |
| [PHP](../reference/sdk/php.md)               | Application tree with generated PHP, Composer dependencies installed in the snapshot, and the resolved RoadRunner configuration when available |
| [Python](../reference/sdk/python.md)         | Application tree with generated registration and a fresh environment prepared by uv, Poetry, or venv and pip                                   |
| [Ruby](../reference/sdk/ruby.md)             | Application tree with generated Ruby and workspace-local gems when Bundler installs them there                                                 |
| [Rust](../reference/sdk/rust.md)             | Executable paths reported by Cargo for the selected binary targets                                                                             |
| [TypeScript](../reference/sdk/typescript.md) | JavaScript selected or emitted by the native project, with its installed Node dependencies and assets in the snapshot                          |

Genesys produces these artifacts through native tooling. You choose which programs ship together
and use your own tooling to distribute them and configure their infrastructure. Use the SDK pages
for exact output limits. For example, the automatic .NET build produces framework-dependent output,
and a TypeScript entrypoint needs a supported JavaScript output. The build records available
dependency information. The destination can still require runtimes, system libraries, or external
assets.

## Read a published build

| Record                                    | What to read there                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.gsys/compile/manifest.json`             | The current build selector, including the build ID, `root`, `manifestPath`, and `metadataPath`                                                                                             |
| `.gsys/compile/builds/<id>/manifest.json` | The version's source discovery, generated and native artifacts, and Worker commands and readiness limits                                                                                   |
| `.gsys/compile/builds/<id>/metadata.json` | Input hashes, sizes and modes, symlink targets, generated and generator file hashes, native commands and tool versions, target and build host information, removed inputs, and diagnostics |
| `.gsys/compile/metadata.json`             | A pointer to the current manifest's `metadataPath` field                                                                                                                                   |

Read the current manifest once and then use the immutable paths it names. Genesys publishes the
selector with a single atomic rename after generation, native build commands, and metadata recording
succeed. A failed candidate leaves the previous selector in place and removes the failed version.
Publication does not start Workers.

Use `root` to resolve relative artifact and native output paths. The manifest paths and each
Worker command's working directory are absolute. An executable can come from the snapshot or an
external tool such as a runtime on `PATH`. The `artifacts` inventory lists new and changed files,
including generated imports outside `.gsys`, native executables, and native dependency installation
output. For SDKs that report native output details, look at `workers[].nativeOutput` in the manifest
and `nativeOutput` by Worker ID in metadata. The metadata's `buildHost` identifies the OS and CPU
that built the snapshot. The native target identifies the intended environment for its output.

Each build takes a fresh snapshot. Changed source, lockfiles, settings, or installed dependencies
become new inputs. The metadata hashes the environment as a single fingerprint instead of recording
its values. Unpinned downloads and native tool behavior can affect outputs. The build records
establish what completed and what files were present. Confirm startup and polling in the destination
environment.

## Retain builds in use

Publication keeps earlier successful versions. Keep each version while any process, container, or
retained Worker requires it. The development supervisor only removes versions it owns that are
neither selected by the current manifest nor required by its active or retained Workers. It does
not scan the build directory for versions to remove. Account for external consumers before manually
removing old versions.

The Genesys build ID identifies the snapshot. Temporal deployment names, Build IDs, routing, and
retirement use the native Temporal configuration and evidence. A new build or a ready replacement
does not authorize retirement of a Worker that native Temporal rules still require.

## Next steps

- Start a published Worker with [Native Worker Deployment](deployment.md).
- Check supported environments and evidence in [Platform Support](../reference/platforms.md).
