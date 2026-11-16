# Genesys documentation and skill parity

Status: ready-for-agent

## Problem Statement

Genesys application authors and coding agents lack a single entry point for version-specific documentation.
The existing documentation covers substantial behavior, but readers must assemble guidance from the repository introduction, package description, and topic pages.
The package description mixes author guidance with internal adapter details.
There is no usable Genesys skill to direct an agent to documentation for its installed version.

Some content describes earlier behavior or validation evidence.
Some links depend on files that are absent from the installed package.
The documentation copy process can retain stale pages after source pages move or disappear.
These gaps make it difficult to find instructions, determine supported behavior, and use the documentation outside the repository.

## Solution

Organize Genesys documentation by task and use plain language and consistent formatting to describe implemented behavior.
Give readers a task index, recommended reading order, getting-started guide, concepts, operational guides, and references.
Retain all eight supported SDK languages and explain their specific capabilities and limits.

Provide one short Genesys skill with the sections specified below.
The skill directs agents to the documentation for the installation they use, then to the relevant page before code changes.
Keep the existing bundled documentation location and support project-local packages, global npm installations, and source development.

Deliver ordinary Markdown and a repository-distributed skill.
Keep the documentation complete and readable without a website or interactive components.
Preserve native Temporal interfaces, the project glossary, accepted architecture decisions, and maintainer instructions.

## User Stories

1. As an application author, I want a task index, so that I can find the page for my current work.
2. As a new application author, I want an ordered reading list, so that I can learn prerequisites before advanced behavior.
3. As an application author, I want consistent product, package, and executable names, so that I can identify the correct installation and commands.
4. As an application author, I want clear prerequisites, so that I can prepare the required native tools and dependencies.
5. As an application author, I want supported installation instructions, so that I can obtain a usable CLI without assuming an unpublished release exists.
6. As an application author, I want a complete Go starting example, so that I can inspect, build, and run a native Worker application.
7. As an installed-package reader, I want complete example content, so that I do not depend on repository-only files.
8. As an application author, I want commands with expected results, so that I can determine whether each step succeeded.
9. As an application author, I want directory trees and layout guidance, so that I can place native definitions and Worker programs correctly.
10. As an application author, I want discovery roots, entries, and definitions distinguished, so that I do not confuse file inventory with native analysis.
11. As an application author, I want package context explained, so that I can preserve each language's module and build rules.
12. As an application author, I want generated registration explained, so that I can consume it through native assembly.
13. As an application author, I want native ownership explained, so that I retain control of Task Queues, configuration, dependency construction, and Worker lifecycle.
14. As an application author, I want unresolved source forms documented, so that I can use explicit native assembly when analysis cannot resolve them.
15. As a CLI user, I want exact command and option references, so that I can use supported behavior without guessing.
16. As a CLI user, I want inspection behavior explained, so that I understand its output, diagnostics, and execution limits.
17. As a developer, I want development-session guidance, so that I can start and stop the processes Genesys owns.
18. As a developer, I want supervisor reuse explained, so that I understand which invocation owns the session lifecycle.
19. As a developer, I want Worker selection and argument forwarding documented, so that I can start the intended native programs.
20. As a developer, I want replacement behavior explained, so that I understand what source changes do to active Workers.
21. As an operator, I want readiness distinguished from retirement eligibility, so that I retain Worker versions that native Temporal rules still require.
22. As an application author, I want versioned build and publication behavior documented, so that I understand which generated artifacts remain selected after a failure.
23. As an operator, I want retention rules explained, so that I keep builds required by active or retained Workers.
24. As an operator, I want native deployment instructions, so that I can start application output through my existing tooling.
25. As an operator, I want build-location and runtime requirements documented, so that I do not assume output is relocatable or self-contained.
26. As an application author, I want mixed-language guidance, so that I preserve native package boundaries in a shared project.
27. As an application author, I want one SDK capability index, so that I can select the reference for my language.
28. As an application author, I want references for Go, Java, .NET, PHP, Python, Ruby, Rust, and TypeScript, so that each supported language has complete guidance.
29. As an application author, I want SDK-specific tooling and source limits, so that I can distinguish unsupported analysis from missing tools.
30. As an operator, I want platform evidence and limits, so that I can assess the environment I intend to use.
31. As an application author, I want implemented behavior distinguished from accepted plans, so that I do not depend on unfinished capabilities.
32. As a coding agent, I want a discoverable Genesys skill, so that I know when to consult Genesys documentation.
33. As a coding agent, I want a short skill that points to detailed pages, so that guidance remains consistent with the installed version.
34. As a coding agent, I want the skill to select the relevant guide before code changes, so that I use the supported authoring model.
35. As a coding agent, I want project-local documentation lookup, so that I read the package used by the project.
36. As a coding agent, I want global npm documentation lookup, so that I can use a global installation without assuming a local dependency exists.
37. As a Genesys contributor, I want checkout documentation lookup, so that guidance matches the source implementation I am changing.
38. As a coding agent, I want missing documentation reported clearly, so that I can correct the installation or build instead of using an unrelated version.
39. As a skill user, I want agent-neutral installation instructions, so that I can use the repository skill with my agent's supported skill directory.
40. As a documentation reader, I want consistent writing and formatting, so that I can navigate familiar explanations and examples.
41. As a documentation reader, I want ordinary Markdown, so that I can read every page without a website renderer.
42. As a documentation reader, I want working links in the repository and installed package, so that references remain usable in either context.
43. As a maintainer, I want one authoritative documentation tree and glossary, so that content changes do not require duplicate edits.
44. As a maintainer, I want internal adapter guidance separated from application guidance, so that users do not mistake internal contracts for public APIs.
45. As a maintainer, I want the package to remove stale generated pages, so that moved or deleted documentation does not remain available by accident.
46. As a maintainer, I want verification of the delivered skill and packaged documentation, so that acceptance reflects what readers actually consume.
47. As a maintainer, I want verification results to state their limits, so that documentation checks do not imply runtime compatibility.

## Implementation Decisions

- **Approved scope.** Q1 approves ordinary Markdown documentation and the skill, with no website. Q2 retains the existing bundled documentation location. Q3 approves the complete file map, skill contract, migration scope, and acceptance checks.
- **Identity.** Use Genesys for the product, `@genesys/cli` for the package, and `gsys` for the executable. Preserve glossary vocabulary throughout the content.
- **Reference model.** Use the reviewed skill and documentation as examples of structure and writing style. Verify all product details against Genesys behavior.
- **Information architecture.** Provide a documentation landing index, getting-started guide, concepts for project structure and native registration, guides for development, builds, deployment and mixed-language projects, and CLI, SDK and platform references. Follow the accepted file map recorded separately.
- **Task navigation.** The landing index identifies the product, package, and executable. Its task table covers setup, discovery, registration, inspection, development, builds, deployment, language selection, and platform questions. Its reading order progresses from setup and concepts to operations and references.
- **Public model.** Explain authored definitions, generated registration, native Worker programs, and Genesys supervision as distinct concepts. Discovery and package context do not establish Task Queues, deployment grouping, or execution order.
- **Page conventions.** Use direct explanations, task-oriented instructions, tables, directory trees, fenced examples, and short next-step links. Use title and description frontmatter, Title Case page titles, and sentence case section headings. Indexes and repository introductions retain ordinary top-level headings.
- **Static delivery.** Translate interactive reference examples into complete static examples with explicit source locations. Use linked indexes for navigation. Do not introduce metadata or dependencies that require an absent website consumer.
- **Starting example.** Use the existing Go example as the first complete authoring path. State prerequisites, necessary source, commands, expected results, and next steps. Installed-package readers must have enough information to follow it without repository-only assets.
- **Complete migration.** Preserve every supported topic from the current documentation. Move CLI details into the CLI reference, layout and registration concepts into concept pages, and operational material into guides. Retain the SDK capability matrix and all eight language references.
- **Maintainer material.** Retain existing maintainer instructions and architecture records. Move internal adapter guidance out of the package introduction into maintainer documentation. Preserve historical issue evidence without changing unrelated statuses or outcomes.
- **Content truth.** Check commands, flags, defaults, generated artifacts, source forms, tooling requirements, and limitations against current implementation. Correct outdated inspection descriptions and reconcile validation statements with their actual evidence. An accepted production-packaging specification does not establish completed support across SDKs.
- **Native boundaries.** Preserve application ownership of native SDK configuration, Task Queues, dependency construction, registration consumption, and Worker lifecycle. Distinguish replacement readiness from retirement eligibility. Keep explicit native assembly available where analysis cannot resolve valid code.
- **Evidence placement.** Put capabilities and limitations beside the behavior they qualify. Keep historical work reports separate from author instructions. Do not broaden a build result or platform check into an unsupported compatibility claim.
- **Skill shape.** Create one canonical repository skill named `genesys`, with a description for creating, editing, and debugging Genesys projects. Retain automatic discovery. Start with a product definition, then include Source of truth, One rule to know before reading, and Install, in that order.
- **Skill routing.** The skill directs agents to the applicable documentation index and then the relevant page before writing Genesys code. Keep detailed guidance in the documentation rather than copying it into skill resources.
- **Primary rule.** The skill's short rule explains that directory discovery and generated registration preserve native ownership of Task Queues, configuration, and Worker lifecycle. Link it to the native registration concept.
- **Installation-aware lookup.** Prefer the documentation for the installation in use. Read project-local package docs for a local dependency, resolve the global npm package location for a global installation, and use checkout docs for source development. Never substitute a different version's documentation silently.
- **Missing documentation.** Report missing installation or build output clearly. Direct readers to supported installation or source-build instructions. Do not invent a scaffold command, a public repository location, or evidence of registry publication.
- **Skill distribution.** Distribute the skill through the repository. Explain how users copy it into their agent's supported skill directory. The product package carries version-specific documentation. This effort does not install a global skill or publish a package.
- **Entry points.** Keep root and package introductions concise and link them to the documentation index. Add relevant pointers to repository agent guidance while preserving existing maintainer instructions.
- **Single source.** Retain one authoritative documentation tree and the existing root glossary. Continue bundling the glossary without maintaining a second authored copy.
- **Packaging.** Keep the existing package build and prepack flow. Clear only the generated documentation subtree before copying current content. The resulting package must include the index, all migrated pages, and the glossary, without stale moved pages.
- **Link integrity.** Update maintained links after moves. Resolve glossary links in source and package layouts, using a narrow packaging-time adjustment if required. Keep repository example links in the repository introduction and place necessary example content in bundled guides.
- **Implementation order.** First verify source behavior, then create entry points and concepts, migrate guides and references, add the skill and entry links, and complete packaging and verification. Preserve the approved scope throughout.
- **Completion criteria.** Every author-facing page is reachable from the index. The skill routes to version-matched content. Supported topics and limits remain complete. Source and packaged links work. Package contents exclude stale pages. Skill validation, formatting, and whitespace checks pass.

## Testing Decisions

- **Accepted verification scope.** Q3 already confirms the verification boundary and the decision to add no tests. No new test seams or additional approval are needed for this specification.
- **Highest existing boundary.** Verify what readers consume: the repository skill and documentation bundled by the normal package build and local packing process. Prefer that delivered artifact over assertions about copy-script internals.
- **External behavior.** Good verification establishes that an agent can locate the correct index, select a guide, follow its links, and read complete instructions for supported behavior. Avoid checks that merely mirror wording or internal implementation.
- **Components covered.** Review the skill's lookup instructions, documentation navigation and content, root and package entry links, documentation copying, glossary handling, and packaged file inventory.
- **Prior art.** Reuse the existing package build, prepack documentation copy, local package-content inspection, formatter, whitespace checks, and available skill frontmatter validator. Existing Go examples and recorded native build evidence support command review.
- **Source and package links.** Check both layouts independently. Include glossary references, moved pages, anchors, and example references. A valid repository link does not establish a valid package link.
- **Skill checks.** Validate the skill structure and manually review local, global npm, and source-development lookup instructions. Verify that an absent matching installation produces clear guidance rather than a different version's content.
- **Package checks.** Build normally and inspect a locally packed package. Confirm that it includes the new index and complete documentation tree. Confirm that the copy operation replaces generated documentation instead of retaining obsolete pages.
- **Light checks.** Run scoped formatting and whitespace checks. Run a focused example only if the migration changes commands and existing evidence cannot establish correctness. Do not add tests or test-only interfaces.
- **Limits.** Record checks actually run and unresolved evidence gaps. Documentation, compilation, package inspection, and skill validation do not establish application runtime or cross-platform compatibility.
- **Specification publication.** This publication requires only review and formatting of the specification and decision record. Product builds and runtime checks belong to implementation, not to publishing this document.

## Out of Scope

- A hosted documentation website, interactive MDX components, or web discovery endpoints.
- Package registry publication, public repository publication, or global skill installation.
- New CLI commands, scaffolding, public JavaScript API exports, or plugin interfaces.
- SDK implementation changes or completion of separate production-packaging work.
- Changes to native Temporal ownership, Task Queue selection, readiness, retirement, or deployment behavior.
- A new domain model, duplicate authored glossary, or replacement of accepted architecture decisions.
- New tests, test harnesses, or test-only interfaces.
- Unrelated issue-status changes or rewritten historical implementation evidence.
- Claims of registry availability, runtime compatibility, relocation, or platform support without evidence.
- Product implementation during this specification-publication task.

## Further Notes

This specification synthesizes the accepted decisions Q1 through Q3.
The [accepted decision record](decisions.md) preserves the exact file map, installation lookup locations, reference sources, and verification commands.
The record supplies concrete implementation context without duplicating those paths in this specification's decisions.

Local inspection established that documentation packaging exists and the skill destination is empty.
It also identified outdated inspection descriptions, repository-only links in bundled pages, and stale-page retention in the copy process.
Implementation must recheck those observations against the then-current source, since other work can change them.

The approved architecture preserves native Temporal interfaces and separates readiness from retirement eligibility.
This specification introduces no conflicting domain terms or architecture decisions.
Its status is ready-for-agent. Publication records agreement and does not claim completed implementation.
