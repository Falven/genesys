---
name: genesys
description: Create, edit, and debug Genesys projects. Use for native Temporal definitions, generated registration, Worker programs, or gsys inspection, builds, and development sessions.
---

# Genesys

Genesys discovers native Temporal definitions and Worker programs through directory conventions.
It generates native registration, builds isolated versions, and supervises local development.

## Source of truth

Start with the documentation index for the Genesys installation in use.

- Project-local npm dependency. Read `node_modules/@genesys/cli/dist/docs/README.md` from
  the project that provides the dependency.
- Global npm installation. Run `npm root --global` and read `@genesys/cli/dist/docs/README.md`
  under the directory it returns.
- Genesys source development. Read `docs/README.md` in the checkout you are changing.

Open the relevant guide from that index before writing or changing Genesys code. If the index
is missing, report the expected path and use the installation or build instructions below to
restore it. Use documentation that matches the version in use.

## One rule to know before reading

Directory discovery and generated registration preserve native SDK ownership. The application
chooses Task Queues, supplies SDK configuration and dependencies, and manages the Worker
lifecycle. Read `concepts/native-registration.md` under the documentation directory you selected.

## Install

Use `docs/getting-started.md` in the Genesys checkout to install a local package tarball or build
the CLI from source. After installing a package, read its bundled documentation index.

To install this skill, copy the repository's `skills/genesys/` directory into the skill directory
your coding agent supports.
