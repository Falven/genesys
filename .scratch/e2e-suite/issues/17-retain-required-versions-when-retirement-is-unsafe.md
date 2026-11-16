# 17: Retain required versions when retirement is unsafe

**What to build:** Genesys keeps the old Worker and build when a pinned version remains required or evidence is unavailable, without changing native routing.

**Blocked by:** [15: Replace Workers and recover from source failures](15-replace-workers-and-recover-from-source-failures.md), [16: Report only attributable native Worker readiness](16-report-only-attributable-native-worker-readiness.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: V01, V02, V03. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Reuse the two-generation fixture and attributed-observation barriers; keep actual native pending work on a required version while the candidate becomes ready.
- [x] Make required native retirement evidence unavailable in a still-live real session where feasible; assert Genesys retains the Worker/build and reports the limitation.
- [x] Change routing/pinning only through native application/tooling and verify Genesys does not make those changes itself.
- [x] Cover stale/incomplete/contradictory decision inputs only for named Genesys defects; document the limitation before any case-local simulation. Stopping Temporal is not a substitute for missing retirement evidence.

## Comments

- 2026-11-16. Provisional `pnpm test:e2e 17-native-retirement-retention`
  passed on e2e integration commit `84d9c2a`. The final run against the
  merged product corrections is pending. Local versions were macOS 27.2.1
  arm64, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, packed
  `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0, Temporal
  TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
- V01 catches early shutdown or build removal. A pending v1 Workflow
  completed its first remote Activity before the source edit. The v2 Worker
  completed a separate native probe and Genesys attributed observed readiness
  to its build. The retained v1 snapshot remained available, and its original
  PID completed the second Activity after release.
- V02 catches unauthorized routing or pinning changes. The test's native
  client pinned the Workflow and set Current to v1, then v2. The native route
  configuration stayed the same across replacement until that second native
  write. After the switch, the native pin still pointed to v1, and v2 remained
  usable without another routing change.
- V03 catches use of ambiguous native poller attribution as retirement
  evidence. The Worker fixture authored the same poller identity for both
  processes. Native Worker enumeration returned distinct instance keys and
  PIDs on the same Task Queue with that shared identity. Genesys reported
  unknown retirement evidence after v2 readiness. The v1 Workflow could
  still query the old Worker, and the old build manifest was unchanged.
- `pnpm exec tsc --noEmit`, scoped formatting and lint, and
  `git diff --check` passed. A never-Current version with the live pin already
  had a native Draining record, so the case uses ambiguous poller attribution.
  Stale and malformed retirement responses, terminal drainage, and other
  platforms remain unverified by this ticket. The case uses real SDK and
  server responses throughout.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 17-native-retirement-retention`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) using the reviewed runner. A closed pinned Workflow Query still returned the retained result after the native Current switch and Workflow completion. The previous immutable manifest remained available.
