# Genesys CLI

`@genesys/cli` provides `gsys` for native Temporal discovery, registration, builds, and development.
Start with the [documentation](#documentation) for your installation.

Use Node.js 24 or later. Install a released version from npm with `npm install @genesys/cli`.
To install a Genesys tarball in your npm project, run:

```bash
npm install /absolute/path/to/genesys-cli.tgz
npx gsys --version
```

For a global installation, use `npm install --global /absolute/path/to/genesys-cli.tgz` and run
`gsys --version`. To use `gsys dev`, install the tools for your SDK and put the Temporal CLI on
`PATH`.

## Documentation

- In a Genesys checkout, open `docs/README.md` from the repository root. Follow **Getting Started**
  for source build instructions.
- In an installed package, open `dist/docs/README.md` from the package root.

Follow **SDK Support** from either index for the tools your SDK requires.
