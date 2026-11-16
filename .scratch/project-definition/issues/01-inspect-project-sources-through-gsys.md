# 01: Inspect project sources through gsys

**What to build:** An installable CLI discovers source roles and native package context and writes inspectable source manifests without executing authored code.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**State:** open

- [ ] Recognize all eight SDK languages from source and package context, including nested source layouts.
- [ ] Recognize recursive Workflow, Activity, Nexus, and Worker source locations. Exclude helpers, native tests, dependencies, and generated output.
- [ ] Record source entries independently from definitions. Do not infer execution order, queues, or Worker placement.
- [ ] Report source diagnostics and unsupported or ambiguous package context accurately.
- [ ] Establish the shared internal tooling contracts used by subsequent SDK tickets. Keep native execution configuration outside manifests.
- [ ] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.
