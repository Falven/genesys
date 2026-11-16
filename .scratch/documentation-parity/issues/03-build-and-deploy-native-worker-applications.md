# 03: Build and deploy native Worker applications

**What to build:** Give an operator a path from a published versioned build to native Worker launch and a reference for supported environments.

**Blocked by:** 01 Start a Genesys project through the skill

**Status:** ready-for-agent

**State:** resolved

- [x] The build guide explains isolation, publication, failed candidates, output records, and retention. It distinguishes implemented output from proposed capabilities.
- [x] The deployment guide explains direct launch, runtime dependencies, stable build paths, and the supported Compose development example without requiring repository-only links from bundled pages.
- [x] The platform reference distinguishes observed behavior from unsupported or unverified combinations. It preserves documented platform and runtime limits with scoped evidence.
- [x] Moved content and its maintained links work in the repository and built documentation. Source review, package inspection, and formatting establish the documented path.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `532315b`.

Packed and installed the CLI on macOS arm64, built the tutorial Go program with `CGO_ENABLED=0`, selected its manifest command, and launched it directly. The Workflow returned `Hello, Ada!`. Compose configuration validation passed. Compose runtime and broader POSIX evidence come from prior repository checks. Windows runtime remains unverified.
