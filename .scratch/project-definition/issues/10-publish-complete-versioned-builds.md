# 10: Publish complete versioned builds

**What to build:** Isolated native builds package Worker code and matching registration without replacing the last successful output on failure.

**Blocked by:** 02: Build native Go Workers.

**Status:** ready-for-agent

**State:** open

- [ ] Publish only after generation and native build success. Preserve authored files.
- [ ] Record all generated output locations and build inputs. Keep build IDs separate from Temporal deployment identities.
- [ ] Keep each build independently usable by its native Worker programs. Do not depend on mutable application source.
- [ ] Retain builds required by active Workers. Remove only owned outputs when no Worker requires them.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
