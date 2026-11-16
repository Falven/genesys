# Rust native registration

The Rust adapter reads Cargo TOML and Rust syntax with the bundled `toml` and `syn` parser. It never loads application code, expands application macros, invokes the application `build.rs`, or runs application Cargo commands during analysis or emission. It compiles only the bundled analyzer, in a fresh temporary directory, using its checked-in dependency lockfile. Cargo and a Rust compiler are required for this tooling step. The native application build can run native build scripts and procedural macros.

The generated API targets released **temporalio-sdk 1.2.0** and **temporalio-macros 1.2.0**, inspected on 2026-11-16. Application Cargo resolution remains authoritative. Missing compiler tools, dependency resolution failures, and syntax errors are diagnostics; the adapter never substitutes guessed definitions.

## Discovery and native names

Discovery follows Cargo library and binary targets and their declared module trees, including inline modules, `mod.rs`, and literal `#[path]` attributes. Native definitions are selected only from the convention's source entries. Private modules do not become public. Binary targets come from `[[bin]]`, `src/main.rs`, and `src/bin/`, with native `autobins`, `autolib`, and `required-features` settings respected. Binary records identify native program candidates; static analysis does not prove that every binary creates a Temporal Worker.

`#[workflow_methods]` implementations expose their native `#[run]` definition. The default Workflow identity is the implementer type name; `#[run(name = "...")]` overrides it. Native init, signal, query, update, validator, and other handler behavior remains in the original SDK macro implementation. No generated constructor replaces it.

`#[activities]` implementations expose each native `#[activity]` method. The default identity is **`Implementer::method`**, not just the method name. Literal name overrides are preserved. `#[activity_definitions]` is a caller declaration, not an implementation. Aliased direct macro imports are recognized. Nonliteral name expressions and external `definition = ...` identities remain unresolved, while generated native registration can still preserve those expressions through the original implementer.

## Generated registration

Artifacts live under `.gsys/compile/rust/<package-key>/`. `scopes.json` records the native target, module, include expression, function name, and required application inputs for each generated registration fragment. Keys derive from the package identity and native target/module names, not the machine's absolute path.

Include a fragment **inside its recorded native module** using its generated `include!(concat!(env!("CARGO_MANIFEST_DIR"), ...))` expression. Call its generated function there with the existing `WorkerOptionsBuilder` and the recorded application inputs. This is a native source include and ordinary Rust function call. Genesys does not inject a Worker, pick a Task Queue, change visibility, or rewrite authored source.

Each function:

- Registers each Workflow through `register_workflow::<T>()`, retaining native initialization and handlers.
- Accepts an application factory for `#[workflow_methods(factory_only)]` and calls `register_workflow_with_factory::<T, _>()`.
- Accepts **one instance per Activity implementer**, even when the implementer has multiple methods, and calls `register_activities(instance)` once. State and dependencies remain owned by the application.
- Returns the native builder and native `WorkflowRegistrationError`; it does not suppress registration errors.

The generated functions have module-local visibility. This avoids exposing private native types. Application assembly in another module can use its existing native construction/assembly functions. No authored definition lists or framework configuration are required.

Equal native names produce a warning only when they collide inside a particular generated module registration. That fragment is omitted. Names in different native modules or targets are not declared global collisions: whether they share a Worker remains an authored assembly decision.

## Native boundaries

Conditional compilation, generic implementations, trait implementations, reexport chains, macro-generated definitions, unavailable modules, and target-specific or unresolved dependency provenance keep their native authored assembly. The adapter records known definitions and explains incomplete analysis; it does not run the compiler's macro expansion as discovery. An unreferenced source entry does not receive generated registration. Rust's compiler remains responsible for type checking, visibility, feature selection, SDK constraints, and native imports.

**Nexus callers and service handlers are distinct.** SDK 1.2.0 exposes Workflow Nexus operation callers but no public Rust Nexus service handler registration API. Nexus source entries therefore receive an SDK capability diagnostic. Genesys does not fabricate a service registration call or count caller operations as service definitions.

## Builds, launch, and observation

Each native binary receives `cargo build --manifest-path Cargo.toml --bin <name> --target-dir <generated-root>/target`, with required target features. Launch uses `cargo run --quiet` with the same manifest, binary, target directory, and features, followed by `--` for application arguments. Cargo chooses the native target-specific artifact location and runner. The working directory is the package root. The versioned build publisher must rebase the directory and generated-root arguments into the isolated build; launch must use that build's source and artifacts.

Cargo honors the application's native configuration. Cross-compilation and custom runners can prevent local process attribution. They do not establish readiness. Neither `Worker::run`, process startup, nor Cargo build success proves successful Temporal polling. Readiness requires native heartbeat attribution to the owned process generation plus fresh poll evidence. Unknown Worker coverage and missing native evidence remain unknown, and never authorize retirement.

SDK compilation can require **`protoc`** through `temporalio-protos` and `prost-wkt-types`. This requirement is separate from the bundled static analyzer, which does not require protoc.

## Verification

Performed without tests or assertion-based checks:

- Bundled analyzer: `cargo check --locked` and `cargo fmt`.
- CLI adapter: TypeScript compilation/typecheck and `oxfmt`.
- Generated registration: native `cargo check` against SDK/macros 1.2.0, including private module-local types, two Workflow implementations in one source, factory-only registration, two Activities sharing one stateful implementer, direct macro aliases, and native name overrides. The consumer was outside the repository and had no Temporal service connection. Native dead-code warnings are expected for the compile-only consumer.

The first native compile reported missing protoc. An isolated protoc from `protoc-bin-vendored-macos-aarch_64 3.2.0` allowed the compile to complete. Runtime polling, service readiness, native retirement, other architectures, and other SDK versions were not exercised.

## Primary sources

- [SDK 1.2.0 registration implementation](https://docs.rs/temporalio-sdk/1.2.0/src/temporalio_sdk/lib.rs.html)
- [Macros 1.2.0 native attributes](https://docs.rs/temporalio-macros/1.2.0/temporalio_macros/)
- [SDK 1.2.0 release package](https://crates.io/crates/temporalio-sdk/1.2.0)
- [Rust module source and path rules](https://doc.rust-lang.org/reference/items/modules.html)
- [Cargo target discovery and native options](https://doc.rust-lang.org/cargo/reference/cargo-targets.html)
