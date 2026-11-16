# 02: Inspect projects and manage development sessions

**What to build:** Give a CLI user an accurate reference for supported commands and a guide for inspecting a project and managing a development session.

**Blocked by:** 01 Start a Genesys project through the skill

**Status:** ready-for-agent

**State:** resolved

- [x] The CLI reference describes actual syntax, flags, defaults, output, diagnostics, and argument boundaries. Inspection describes native analysis and its execution limits.
- [x] The development guide covers Worker selection, launch, supervisor reuse, process ownership, replacement, and shutdown. It distinguishes readiness from retirement eligibility and explains the supported limit.
- [x] Moved content and its maintained links work in the repository and built documentation. Comparison with the CLI and implementation, package inspection, and formatting establish the documented path.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `47029d9`.

Compared CLI syntax and behavior with implementation and the installed tarball. Help and version succeeded. An empty Worker executable override produced the expected diagnostic and exit 1. Inspected the bundled reference and development guide, moved links, and removal of the former development path. Live retirement was outside this check.
