# 13: Reuse an existing supervisor

**What to build:** A later development invocation reuses a responding supervisor without generation, builds, watching, or process startup.

**Blocked by:** 11: Run a managed development session.

**Status:** ready-for-agent

**State:** open

- [ ] Record the last ready endpoint per project root and probe it before any build or startup.
- [ ] Allow new startup if the endpoint is absent or unresponsive. Do not add ownership locks, identity handshakes, or protocol compatibility checks.
- [ ] Stream plain logs and status without a terminal UI. Secondary disconnect does not stop the owner.
- [ ] Reject startup options that would reconfigure the reused session. The endpoint record remains advisory.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
