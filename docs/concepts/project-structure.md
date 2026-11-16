---
title: "Project Structure"
description: "Organize discovery roots, source entries, and native package context in a Genesys project."
---

Genesys finds source entries through directory conventions. Each entry belongs to a native package.
The native SDK adapter reads that package to find definitions and Worker entrypoints.

## Place source in a discovery root

Name a directory `temporal` to make it a discovery root. A project can contain discovery roots
at any package depth. Within a discovery root, put Workflow, Activity, and Nexus service handler
source under the directories for those roles. Put each Worker program under `workers/<name>/`.
The directory name provides the Worker selector for `gsys dev --worker <name>`.

A Go package with one Worker can use this layout.

```text
orders/
├── go.mod
└── temporal/
    ├── workflows/
    │   └── order.go
    ├── activities/
    │   └── payment.go
    ├── nexus/
    │   └── catalog.go
    ├── lib/
    │   └── policies.go
    └── workers/
        └── fulfillment/
            └── main.go
```

The role directories are optional. Genesys also recognizes named Worker directories outside
`temporal/` in the native package layout. Use the Worker source conventions for your language.
Worker names used for selection must be unique across the project. A directory name does not
select the Worker's Task Queue. The native Worker program sets it.

## Understand what an entry identifies

An entry is a file that matches discovery rules. It can contain zero, one, or several definitions.
For example, `temporal/activities/payment.go` can define both `Charge` and `Refund` while appearing
as one entry. A definition's identity comes from the native SDK and any resolved registration
options. It can differ from the file or symbol name.

File extensions classify candidate source languages. The SDK adapter determines whether native
build rules include an entry and whether it contains a supported definition. For example, a Go
file can belong to a discovery root and be excluded by the build target or build tags. See the
[SDK support matrix](../reference/sdk/index.md) for supported source forms.

## Keep native package boundaries

Genesys assigns each entry to the nearest ancestor package manifest for its language. For
example, `go.mod` supplies Go package context, and `pyproject.toml` can supply Python package
context. Native module resolution, dependencies, visibility, build settings, and source inclusion
continue to apply.

An entry without a matching package context produces an error. If several .NET project files share
a directory, inventory reports the ambiguity for native analysis to resolve. For a project with
independent packages, use the [Mixed-Language Projects guide](../guides/mixed-language-projects.md).

## Keep shared code outside entry discovery

Use `lib/` for source that native packages can import without making the files discovery entries.
Genesys excludes hidden directories, dependency directories such as `node_modules/` and `vendor/`,
native test directories and filename patterns, TypeScript declaration files, and recognized
generated source. It skips symlinks during inventory and records a diagnostic for each skipped link.

Some output paths are specific to a package context. Genesys excludes `bin/` and `obj/` inside
.NET package contexts and `build/` inside Java, Python, or TypeScript package contexts. A Ruby
package can use `bin/` for executable source. Python's `workers/__init__.py` is package
initialization. Give each Python Worker a named directory.

## Next steps

See how Workers consume generated code in [Native Registration](native-registration.md).
Inspect a sample project in [Getting Started](../getting-started.md#inspect-the-project).
