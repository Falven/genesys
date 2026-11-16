---
title: "CLI"
description: "Inspect projects, build native Worker applications, and run development sessions with gsys."
---

`gsys` is the executable installed by `@genesys/cli`. Run a command from the project root or pass
a project directory relative to the directory where you run the command. Absolute project paths
also work. Each command defaults to the current directory.

## Commands

| Command                            | Description                                                 |
| ---------------------------------- | ----------------------------------------------------------- |
| `gsys inspect [project-directory]` | Discover entries and analyze native definitions and Workers |
| `gsys build [project-directory]`   | Generate registration and publish an isolated native build  |
| `gsys dev [project-directory]`     | Start or reuse a development session                        |
| `gsys`, `gsys -h`, `gsys --help`   | Print usage                                                 |
| `gsys dev -h`, `gsys dev --help`   | Print usage                                                 |
| `gsys --version`                   | Print the CLI version                                       |

Use help and version flags as shown. `inspect` and `build` each accept at most one positional
directory and have no command-specific options. Unsupported commands and arguments exit with
status 1 and write an error to stderr.

## `gsys inspect`

```bash
gsys inspect [project-directory]
```

Run `gsys inspect` to see what Genesys discovers before you build or start Workers. It inventories
source files, assigns package context, and runs native static analysis for each package. Depending
on the SDK, analysis can invoke native tools or analyzer helpers to resolve source and types.
Inspection stops at static analysis. It leaves authored imports, constructors, factories, build
scripts, and Worker entrypoints unevaluated.

### JSON output

`gsys inspect` prints one JSON object to stdout.

| Field           | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `schemaVersion` | Manifest schema version, currently `1`                                             |
| `analysis`      | `native-analysis`, including results with diagnostics                              |
| `packages`      | Native package context, including the language, root, and manifest paths           |
| `entries`       | Discovered source files, with their roles and package associations                 |
| `definitions`   | Native Workflow, Activity, and Nexus service handler definitions found by analysis |
| `workers`       | Discovered Worker programs, with selector names and startup plans where resolved   |

Genesys writes the same manifest fields except `workers` to
`.gsys/discovery/manifest.json` in the project. Source paths in that file are relative to the
project root and use forward slashes. A single source entry can contribute multiple definitions.
A Worker can appear without a resolved `start` command.

### Diagnostics

Read stderr or `.gsys/discovery/diagnostics.json` for diagnostics. stderr gives the severity
(`error`, `warning`, or `info`), code, source path when available, and message. The JSON file can
include a source line and column or related locations.

Inspection can return partial JSON alongside error diagnostics. Any error diagnostic sets exit
status 1. Warnings and informational diagnostics alone allow status 0. If the command fails before
it can write the result, it reports a `gsys:` error to stderr and exits with status 1.

See [Project Structure](../../concepts/project-structure.md) for discovery rules and the
[SDK reference](../sdk/index.md) for native tooling, supported forms, and static-analysis limits.

## `gsys build`

```bash
gsys build [project-directory]
```

Build creates an isolated source snapshot, generates native registration, and runs the native
build commands for the discovered Worker programs. Native build tools can execute authored
build code. Genesys sends native build output to stderr and prints the published build record as
JSON on stdout. The record contains the build ID, snapshot root, artifact and Worker records,
and paths to its manifest and metadata.

`.gsys/compile/manifest.json` selects the last successfully published build. Analysis or
generation errors produce discovery JSON with Worker plans on stdout, diagnostics on stderr,
and exit status 1. A native command failure reports an error on stderr and exits with status 1
before printing a build record. A failed build leaves the previous selection available.
See [Versioned Builds](../../guides/builds.md) for publication and retention details.

## `gsys dev`

```bash
gsys dev [project-directory] [--worker <name>]... \
  [--worker-exec=<name>:<executable>]... [--worker-arg=<name>:<argument>]... \
  [-- <temporal-arguments>...]
```

Starts the managed Temporal development server and launches selected Worker programs from an
isolated build. If a supervisor for the project is already responding, omit startup options to
read its current status and live logs.

| Option                              | Default                        | Effect                                                                                |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `--worker <name>`                   | All discovered Worker programs | Select one named program. Repeat to select several.                                   |
| `--worker-exec=<name>:<executable>` | The inferred startup command   | Replace the executable and its inferred arguments. The last override wins for a name. |
| `--worker-arg=<name>:<argument>`    | No extra arguments             | Pass one argument. Repeat to pass arguments in the given order.                       |
| `-- <temporal-arguments>...`        | Native Temporal CLI defaults   | Pass the remaining arguments directly to `temporal server start-dev`.                 |

Unknown Worker names and startup options for unselected Workers cause selection errors. An
executable override requires a known native working directory and uses only the supplied Worker
arguments. Without an override, supplied arguments follow the inferred startup arguments.

Only the first colon separates the Worker name from the value. Later colons, spaces, Unicode,
and empty arguments are preserved. Quote each value for your invoking shell. For example, if the
`billing` program accepts a label, `--worker-arg='billing:--label=local: billing'` passes the whole
label option as one argument. Genesys passes argument arrays directly to the native processes.

Relative Temporal paths use the directory where you run `gsys`. Worker commands run from their
native working directory inside the build. The Worker program sets its own Temporal address,
Namespace, and Task Queue.

The owner labels build, server, and Worker output. It writes errors and child stderr to stderr
and status and child stdout to stdout. A reused invocation streams the current status and live
plain logs to stdout. See [Development](../../guides/development.md) for session ownership,
replacement, and shutdown.
