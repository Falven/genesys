# 07: Author Rust and TypeScript Workers

**What to build:** Give Rust and TypeScript authors the information to discover supported definitions and understand their native build output.

**Blocked by:** 01 Start a Genesys project through the skill

**Status:** ready-for-agent

**State:** resolved

- [x] Both references describe source forms, native tooling, generated registration, limitations, and the scope of production output supported by the implementation.
- [x] Capability and validation claims match implementation. Maintained links and SDK matrix entries point to the migrated references.
- [x] Source review, bundled page and link inspection, and formatting establish the documented path.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `d00c0b7`.

Built the TypeScript example with SDK 1.25.0 and compiler 6.0.3, checked emitted JavaScript syntax and output paths, and built the Rust fixture with Cargo and protoc. Inspected both Rust executables and module scopes. Checked that the tarball contained both migrated references and omitted obsolete paths.
