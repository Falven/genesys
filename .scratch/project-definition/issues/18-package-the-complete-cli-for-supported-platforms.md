# 18: Package the complete CLI for supported platforms

**What to build:** An npm-distributed CLI supports macOS, Linux, and Windows with documented SDK features and limits.

**Blocked by:** 12: Select Workers and forward native arguments, 13: Reuse an existing supervisor, 15: Retire eligible Worker versions, 16: Run mixed-language projects, 17: Run the same builds through Compose and local processes.

**Status:** ready-for-agent

**State:** open

- [ ] Package executable code and required SDK tooling assets. Ensure installed commands resolve their own resources.
- [ ] Handle native paths, argument boundaries, executable invocation, and process ownership on each supported OS.
- [ ] Document commands, conventions, generated artifacts, native assembly, and development lifecycle.
- [ ] Record exact SDK versions and individual capabilities. Do not claim unverified SDK or platform support.
- [ ] Use available native builds, type checks, formatting, and review. Record verification gaps honestly.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
