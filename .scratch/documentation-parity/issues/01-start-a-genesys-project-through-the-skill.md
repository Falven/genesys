# 01: Start a Genesys project through the skill

**What to build:** Give an author or coding agent a complete path from the Genesys skill and task index to inspecting, building, and running their first native Go Worker.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**State:** resolved

- [x] The repository skill follows the section order in the specification and routes local package, global npm package, and checkout users to matching documentation. Missing documentation produces clear guidance.
- [x] The Markdown index gives a reading order and links to the available guides and references. Repository, package, and agent guidance provide an entry point.
- [x] The getting-started guide provides prerequisites, supported installation or source build, a complete Go example, commands, expected results, and next steps. Bundled readers can supply the example files themselves.
- [x] The concept pages explain discovery roots, entries, package context, definitions, and generated registration. They explain application ownership of native assembly, Task Queues, configuration, and the Worker lifecycle.
- [x] A normal package build and local package inspection show the index, guides, and glossary at the existing bundled location. Building over old output clears stale documentation. Skill validation, link checks, and formatting pass.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `125e01f`.

Verified the skill with the frontmatter validator. Built over a stale docs sentinel and confirmed its removal while a sibling build file remained. Packed and installed the CLI offline. On macOS arm64, rebuilt the example from bundled Markdown, inspected and built it, executed `Greeting` with result `Hello, Ada!`, and confirmed one Ctrl+C stopped the Worker before managed Temporal. Reviewed checkout and global npm lookup.
