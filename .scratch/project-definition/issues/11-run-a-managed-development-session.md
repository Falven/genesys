# 11: Run a managed development session

**What to build:** A new gsys dev session starts managed Temporal and all discovered native Worker programs with plain process logs.

**Blocked by:** 10: Publish complete versioned builds.

**Status:** ready-for-agent

**State:** open

- [ ] Use the same all-Worker behavior in interactive and noninteractive environments without prompts.
- [ ] Start the managed Temporal development server with native temporary-state defaults. Do not add a server-selection mode.
- [ ] Report native readiness beyond process creation. Report missing evidence without inventing readiness.
- [ ] Own process lifecycle and print startup failures and process errors.
- [ ] Request native graceful Worker shutdown before stopping Temporal. Respect native shutdown settings. A second interrupt forces owned processes only.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
