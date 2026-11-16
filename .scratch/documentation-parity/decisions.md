# Genesys documentation parity decision record

Decision state: Accepted. The user approved Q1, Q2, and Q3.

## Outcome

Give application authors and coding agents a documentation entry point for the Genesys version they use.
An agent loads one short skill, finds documentation for its installed version, reads the task index, and follows the relevant guide or reference.

This record preserves the accepted plan and exact file map. The accompanying specification governs implementation. Acceptance does not claim that the migration is complete or authorize registry publication.

## Accepted decisions

- **Q1:** Provide the complete skill and documentation system in ordinary Markdown. A hosted website is outside this effort.
- **Q2:** Retain `node_modules/@genesys/cli/dist/docs/` as the project-local documentation location. Remove stale generated documentation before copying the current source tree.
- Use the product name **Genesys**, package name `@genesys/cli`, and executable name `gsys`.
- Use plain language, consistent formatting, and task-based navigation for Genesys commands and behavior.

## Reference and constraints

The reference material included these examples:

- A skill with a short product definition, source of truth, one important rule, and installation instructions.
- `docs/README.md`: task table, reading order, public model, and component responsibilities.
- `docs/getting-started.mdx`: prerequisites, concrete actions, expected results, and next steps.
- `docs/concepts/project-structure.mdx`: layout choices, directory trees, and boundaries.
- `docs/reference/cli/index.md`: command syntax, options, defaults, and behavior.
- `AGENTS.md`: Title Case page titles, sentence case section headings, and Markdown conventions.

The reference includes a website and MDX components. This effort transfers their useful content into ordinary Markdown.
Navigation will use linked indexes. It will not introduce unused website metadata, components, or dependencies.

Genesys retains its root `GLOSSARY.md`, `docs/adr/`, and `docs/agents/`.
The accepted decisions preserve native Temporal interfaces and separate replacement readiness from retirement eligibility.
No new domain model or public JavaScript API is required.

## Accepted file map

```text
skills/
└── genesys/
    └── SKILL.md
docs/
├── README.md
├── getting-started.md
├── concepts/
│   ├── project-structure.md
│   └── native-registration.md
├── guides/
│   ├── development.md
│   ├── builds.md
│   ├── deployment.md
│   └── mixed-language-projects.md
├── reference/
│   ├── cli/
│   │   └── index.md
│   ├── sdk/
│   │   ├── index.md
│   │   ├── go.md
│   │   ├── java.md
│   │   ├── dotnet.md
│   │   ├── php.md
│   │   ├── python.md
│   │   ├── ruby.md
│   │   ├── rust.md
│   │   └── typescript.md
│   └── platforms.md
├── agents/                   # Existing maintainer instructions
└── adr/                      # Existing architecture decisions
```

| Current content                                                  | Destination and treatment                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Root README quick start and Go example                           | `docs/getting-started.md`; retain a concise root introduction and entry link                   |
| Package README commands and flags                                | `docs/reference/cli/index.md`; retain a concise package introduction and installation guidance |
| Discovery layout and exclusions                                  | `docs/concepts/project-structure.md`                                                           |
| Generated registration and native ownership                      | `docs/concepts/native-registration.md`                                                         |
| `docs/builds/versioned-builds.md`                                | `docs/guides/builds.md`                                                                        |
| `docs/builds/development-replacement.md` and supervisor guidance | `docs/guides/development.md`                                                                   |
| `docs/deployment.md`                                             | `docs/guides/deployment.md`                                                                    |
| `docs/mixed-language-projects.md`                                | `docs/guides/mixed-language-projects.md`                                                       |
| `docs/sdk-support.md`                                            | `docs/reference/sdk/index.md`                                                                  |
| `docs/sdk/*.md`                                                  | Corresponding pages in `docs/reference/sdk/`                                                   |
| `docs/platforms.md`                                              | `docs/reference/platforms.md`                                                                  |
| Package README internal adapter contract                         | Maintainer documentation under `docs/agents/`, linked separately from author guidance          |

Update maintained repository links when pages move. Do not retain duplicate full pages.
Keep historical implementation records in `.scratch/`; do not rewrite their outcomes as part of this migration.

## Writing and navigation

Use direct explanations and organize instructions around tasks.
Preserve precise Genesys terms, supported forms, limitations, and verification scope.
Avoid replacing user guidance with implementation history or repeated validation disclaimers.

Pages use `title` and `description` frontmatter.
Use Title Case for page titles and sentence case for section headings.
The docs index and repository READMEs retain ordinary Markdown H1 headings.
Use fenced code with language tags, relative file links, tables, directory trees, and short next-step sections.
Replace interactive examples with complete static examples and explicit file paths.

`docs/README.md` must identify the product, package, and executable.
Its task table must route setup, discovery, registration, inspection, development, builds, deployment, language selection, and platform questions.
Its reading order must start with getting started and project structure, then explain native registration and operational guides.
The public model must distinguish authored definitions, generated registration, native Worker programs, and Genesys supervision.
Describe legal, runtime, and integration behavior only where it applies to Genesys.

## Skill contract

Create one canonical `skills/genesys/SKILL.md`, without copied reference documents or helper scripts.
Use YAML `name: genesys` and a description for creating, editing, or debugging Genesys projects.
Keep normal automatic skill discovery enabled.

Use this section order:

1. `# Genesys`: a short product definition.
2. `## Source of truth`: locate the applicable docs, start with `README.md`, and read the relevant page before writing Genesys code.
3. `## One rule to know before reading`: directory discovery and generated registration preserve native SDK ownership of Task Queues, configuration, and Worker lifecycle. Link to native registration.
4. `## Install`: direct readers to supported installation or source-build instructions, then the bundled documentation.

Resolve documentation according to the installation in use:

- Project-local package: `node_modules/@genesys/cli/dist/docs/README.md`.
- Global npm package: locate the global package root with `npm root --global`, then read `@genesys/cli/dist/docs/README.md` beneath it.
- Genesys source development: use this checkout's `docs/README.md` for this checkout's implementation.

Do not substitute checkout documentation for an unrelated installed version.
If the relevant docs are absent, report the missing installation or build output.
Do not invent a scaffold command or assume an npm release exists.
Document how to copy the repository skill into the consuming agent's skill directory.
Keep installation agent-neutral. Do not install a global skill or publish the package during this effort.
Distribute the skill through the repository and ship version-specific documentation in the product package.

## Implementation sequence

1. **Check content against source.** Record implemented commands, flags, discovery rules, generation behavior, SDK forms, build output, and platform limits. Distinguish implementation from planned production-packaging work. Reconcile stale inspection and validation statements.
2. **Build the documentation entry points.** Add the task index, getting-started page, and concepts. Use the existing Go example for the first complete path. Include sufficient source and commands for installed-package readers.
3. **Migrate guides and references.** Apply the file map and common writing conventions. Preserve all eight SDKs. Explain limitations alongside the behavior they constrain. Keep native SDK documentation authoritative for SDK behavior.
4. **Add the skill and entry links.** Write the short skill. Update root/package READMEs and repository agent guidance to direct readers to the relevant docs. Preserve existing maintainer instructions.
5. **Update packaging and verify.** Clear only the generated docs subtree, then copy the current docs and glossary. Check source links and packaged links separately. Inspect a locally packed package and validate the skill.

## Packaging and link rules

Keep root `docs/` as the authoritative content tree.
Keep the existing build and prepack pipeline and the `dist/docs` package destination.
Copy the root glossary into the package as today; do not maintain a second authored glossary.
Resolve glossary links correctly in both source and bundled layouts, with a narrow packaging-time link adjustment if required.
Avoid package links to repository-only example directories. Put necessary example content in the guide and keep repository example links in the root README.
Do not invent a public repository URL for the private remote.

## Acceptance and verification

- The skill follows the section order above and uses valid Genesys paths and terminology.
- The documentation index reaches every author-facing page and gives a clear reading order.
- Every existing supported topic appears in the new structure, including all eight SDKs and their limitations.
- Examples, commands, defaults, and capability claims agree with implementation evidence.
- The documentation distinguishes static inspection from native builds and running Workers.
- Production packaging descriptions identify supported output per SDK; an accepted specification alone does not prove delivery.
- Source and packaged documentation links resolve, including glossary and example references.
- The built and locally packed package contains the new docs index and complete documentation tree, without stale moved pages.
- The source skill passes the available skill frontmatter validator and a manual review of its lookup instructions.
- Formatting and whitespace checks pass for changed files.

Use the normal package build, scoped formatting checks, `git diff --check`, and local package-content inspection.
Do not add tests. A documentation build or package inspection does not establish runtime compatibility.
Run a focused example only if the migration changes commands and existing evidence cannot establish their correctness.
Report checks actually run and unresolved evidence limits.

## Exclusions

Website implementation, MDX components, web discovery endpoints, registry publication, global skill installation, new CLI commands, public API exports, SDK implementation changes, unrelated issue-status changes, and new tests.

## Confirmation

The user approved Q3, including the file map, skill contract, migration scope, and acceptance checks.
The user then requested publication through the to-spec skill.
The specification is ready for implementation. This publication task does not implement the migration.
