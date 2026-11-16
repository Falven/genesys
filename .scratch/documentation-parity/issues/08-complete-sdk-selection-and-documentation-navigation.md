# 08: Complete SDK selection and documentation navigation

**What to build:** Give readers one SDK selection reference and a complete navigation path from the skill or either README to every author guide and reference.

**Blocked by:** 02 Inspect projects and manage development sessions, 03 Build and deploy native Worker applications, 04 Author Go and Python Workers together, 05 Author Java and .NET Workers, 06 Author PHP and Ruby Workers, 07 Author Rust and TypeScript Workers

**Status:** ready-for-agent

**State:** resolved

- [x] The SDK matrix covers all eight SDKs and links to their references. The task index covers the approved topics and offers a complete reading order.
- [x] Repository and package introductions direct readers to the docs. Internal adapter guidance remains available separately from author guidance.
- [x] Maintained source and package links and anchors resolve, including the glossary. The normal build and local package contain the complete documentation tree and no retired pages.
- [x] Review the skill’s three lookup routes and missing-docs behavior. Run scoped formatting, whitespace, and package checks, and record validation limits.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `85cac6c`.

The final build and normal pack include all 19 author pages and the canonical glossary. A pristine checkout resolved 131 local links, and the extracted tarball resolved 110. The normal build removed seeded obsolete pages in the packaging check. The skill validator and scoped formatting and whitespace checks passed. An isolated global npm installation located the bundled index and returned CLI version 0.0.0. Review preserved the adapter boundary and recorded focused Go/Python and TypeScript Workflow results on macOS arm64.
