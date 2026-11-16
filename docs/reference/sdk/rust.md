---
title: "Rust SDK"
description: "Discover Rust Workflows and Activities, include module-local registration, and build native executables with Cargo."
---

Keep your Cargo targets and Temporal Worker program. Genesys reads the native module tree and generates registration functions that you call with your existing `WorkerOptionsBuilder`. Your application supplies instances, factories, connections, Task Queues, and the Worker lifecycle.

Install Cargo and `rustc` on the build host. `gsys inspect` compiles the bundled analyzer for the host with its own lockfile. The analyzer reads Cargo TOML and Rust syntax without expanding application macros or running application `build.rs` scripts. `gsys build` runs normal Cargo builds, which can execute those scripts and procedural macros. Application dependencies such as `temporalio-protos` and `prost-wkt-types` can require `protoc`.

Generated registration targets `temporalio-sdk` and `temporalio-macros` **1.2.0**. Use Cargo to resolve and validate your application's actual versions. The native registration API and macro forms are described in the [SDK reference](https://docs.rs/temporalio-sdk/1.2.0/temporalio_sdk/) and [macro reference](https://docs.rs/temporalio-macros/1.2.0/temporalio_macros/).

## Place definitions in the native module tree

Put definitions under a `temporal/` discovery root and declare those modules from a native Cargo library or binary target. For example, a binary can declare `mod temporal;` in `src/main.rs`, with `src/temporal/mod.rs` declaring `mod workflows;` and `mod activities;`.

```text
orders/
├── Cargo.toml
└── src/
    ├── main.rs
    └── temporal/
        ├── mod.rs
        ├── activities/
        │   └── mod.rs
        └── workflows/
            └── mod.rs
```

Genesys follows inline modules, `mod.rs`, and literal `#[path]` attributes. It uses native target declarations and conventions, including `[lib]`, `[[bin]]`, `src/main.rs`, and `src/bin/`. It respects `autolib`, `autobins`, and binary `required-features`. A binary target identifies a candidate program. Inspect its source to see which Workers it starts. See [Rust module rules](https://doc.rust-lang.org/reference/items/modules.html) and [Cargo target rules](https://doc.rust-lang.org/cargo/reference/cargo-targets.html).

| Kind     | Recognized form                              | Native identity and behavior                                                                                        |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Workflow | `#[workflow_methods]` with a `#[run]` method | The implementer type name by default. `#[run(name = "...")]` overrides it. Initialization and handlers stay native. |
| Activity | `#[activities]` with `#[activity]` methods   | `Implementer::method` by default. Literal `#[activity(name = "...")]` overrides it.                                 |
| Nexus    | Workflow operation callers in SDK 1.2.0      | Nexus entries receive a capability diagnostic. This SDK has no public Nexus service handler registration API.       |

Direct macro import aliases resolve. `#[activity_definitions]` declares caller types. Register the Activity implementation defined with `#[activities]`. Nonliteral names and external `definition = ...` identities can remain unresolved in inspection while the generated call still uses the native implementer.

Keep explicit native assembly for conditional or macro-generated definitions, generic or trait implementations, unresolved re-exports or dependency provenance, and sources the analyzer cannot reach. Cargo decides visibility, feature selection, and type validity.

## Include generated registration

1. Run `gsys inspect .` to review definitions and diagnostics. Use `gsys build .` to write the registration files into the versioned build. For the first build, keep your working explicit native assembly while Genesys generates the fragments.
2. Find the build's `root` in `.gsys/compile/manifest.json`. Inside that root, open `.gsys/compile/rust/<package-key>/scopes.json`. Each scope records its target, module, fragment path, `include` expression, `function` name, and `inputs`.
3. Copy the recorded `include!(concat!(env!("CARGO_MANIFEST_DIR"), ...))` expression into the authored module named in that scope, such as `src/temporal/workflows/mod.rs`. Call the recorded function with the existing builder and the listed arguments. Build again to compile the include in the new snapshot.

Each fragment uses `register_workflow::<T>()` for standard Workflows. A `#[workflow_methods(factory_only)]` Workflow takes your factory and uses `register_workflow_with_factory::<T, _>()`. For Activities, pass one existing instance per implementer, even when that instance supplies several methods. The function calls `register_activities(instance)` once and returns the native builder or `WorkflowRegistrationError`.

Scope keys come from the Cargo package context and target or module names. A fragment can use private types in its own module. Expose a native assembly function from that module if the Worker builds its options elsewhere. If two definitions have the same identity within the same kind and generated module scope, Genesys warns and omits that fragment. Explicit native assembly can keep their Worker registrations separate.

## Build and run an executable

Run `gsys build .` from the project root. Genesys generates registration in the snapshot, then runs Cargo in each discovered binary's package directory. The command uses `cargo build`, `--manifest-path Cargo.toml`, `--package`, `--bin`, and an isolated `--target-dir`, with `--features` for the binary's required features. Cargo controls default features, the `dev` profile, linking, and target selection through native settings such as `.cargo/config.toml` or `CARGO_BUILD_TARGET`. Genesys reads Cargo's executable reports using `--message-format=json-render-diagnostics`.

Open `.gsys/compile/manifest.json` and find the program in `workers`. `nativeOutput.paths` lists the executables reported by Cargo, relative to the build's `root`. An explicit Cargo target can put these files in a target-specific subdirectory. If Cargo reports one executable, the record includes `start.executable` and `start.cwd`. If it reports several, choose the executable for the destination from `nativeOutput.paths`.

Run the recorded executable directly from `start.cwd` with the usual arguments, environment, and Temporal connection settings. For a binary named `orders` that reports one executable, use `jq` to read the startup paths:

```sh
manifest=.gsys/compile/manifest.json
executable=$(jq -er '.workers[] | select(.name == "orders") | .start.executable' "$manifest")
build_directory=$(jq -er '.workers[] | select(.name == "orders") | .start.cwd' "$manifest")
(cd "$build_directory" && "$executable")
```

On the destination, supply any dynamic libraries and runtime assets required by the selected Cargo target and application. Cargo and `rustc` are build tools unless your application invokes them at runtime. Choose which executables and supporting files belong in each [application package](../../guides/deployment.md).

`gsys dev` launches through `cargo run --quiet` with the selected binary and features so Cargo can use its configured runner. See [versioned builds](../../guides/builds.md) for build metadata and publication.

Earlier native builds compiled generated registration against SDK/macros 1.2.0 on macOS arm64 and recorded executables with implicit and explicit Apple arm64 target settings. The evidence covers compilation and executable recording on macOS arm64.
