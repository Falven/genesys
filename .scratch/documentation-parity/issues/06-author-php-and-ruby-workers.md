# 06: Author PHP and Ruby Workers

**What to build:** Give PHP and Ruby authors the information to use generated registration and build and start native Worker programs with the required runtime dependencies.

**Blocked by:** 01 Start a Genesys project through the skill

**Status:** ready-for-agent

**State:** resolved

- [x] Both references describe native construction, generation, build and runtime requirements, SDK capability limits, and applicable platform restrictions.
- [x] Capability and validation claims match implementation. Maintained links and SDK matrix entries point to the migrated references.
- [x] Source review, bundled page and link inspection, and formatting establish the documented path.

Follow the approved specification and decision record. Add no tests.

## Comments

2026-11-16. Integrated in `31b18ac`.

Recreated both reference examples and published builds through the packed CLI in Linux arm64 containers. PHP 8.5.12 and Composer 2.11.2 passed platform dependency checks. Ruby 3.4.12 and Bundler 2.6.9 passed dependency checks. Inspected generated files and manifest outputs. Worker execution evidence comes from prior repository checks.
