# 16: Report only attributable native Worker readiness

**What to build:** Genesys status distinguishes real observed polling from startup-only, missing, stale or incomplete evidence.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: C07, W03, W04. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use native programs with one and multiple Worker instances; check Genesys attributes observed state to the owned process generation and known task types.
- [x] Use a real program that never polls and native lifecycle changes to expose false ready claims; log text/process creation is insufficient.
- [x] Report incomplete coverage accurately. Do not test Temporal heartbeat correctness or infer replay compatibility.
- [x] Where a malformed/stale evidence branch cannot reasonably be produced natively, record the specific defect and reproduction limit before adding a minimal case-local substitution.
- [x] Provide native observation barriers usable by the replacement/retirement cases.

## Comments

- 2026-11-16. Provisional `pnpm test:e2e 16-native-readiness` passed on
  macOS 27.2.1 arm64 with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest
  5.1.0, packed `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0,
  Temporal TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
  The final run against the merged product corrections is pending.
- C07 detects readiness inferred from a subset of owned instances. A second
  native Worker on the same PID reported a heartbeat before it received work.
  Genesys kept the generation unknown and reported the two instances separately.
  A third Worker completed native work with heartbeat registration disabled.
  Genesys listed the two observed instances and reported the coverage limit.
- W03 detects startup, unrelated evidence, or prior observations keeping a
  generation ready. The startup-only program printed a ready-like line and
  stayed unknown in supervisor status. A separate process used the same built
  program and queue and completed native work. Its evidence did not make the
  owned instance ready. After the second owned instance stopped, the owner
  returned to unknown while the primary instance continued to execute work.
- W04 detects rejection of attributable polls and overstatement of observed
  capability. Native results identified the executing PID. The native sample
  showed Workflow and Activity polls on the primary queue and a Workflow poll
  on the second queue. Genesys reported both instance keys and their common
  owned PID under the published build ID and qualified the readiness claim.
  The replacement cases can use `waitForObservedReady` from
  `e2e/native-readiness.ts` to wait for a generation's attributed status.
- Strict TypeScript, scoped formatting and lint, and `git diff --check`
  passed. The case checks the invalidation of a stopped instance's prior
  readiness. A running instance's poll-age expiry would require an idle
  period beyond the product's two-minute freshness window. Authored Go SDK
  Workers and the native CLI do not expose a way to emit a malformed
  observation response that could test whether Genesys rejects malformed
  attribution data. Those branches and other platforms remain unverified.
  The case used unmodified native evidence.
- 2026-11-16. On product main `2e61166`, the prior case timed out after
  45 seconds because Genesys still showed the stopped instance as ready.
  The revised case waits for native evidence that the instance is no
  longer running or for the heartbeat or successful poll to expire under
  the Genesys two-minute freshness window. It then checks that a Workflow
  still runs on the primary instance, the stopped row becomes unknown,
  and the supervisor reports the process running with unknown readiness.
  `pnpm test:e2e 16-native-readiness` passed on macOS 27.2.1 arm64 in
  31.13 seconds with Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  packed `@genesys/cli` 0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0,
  Temporal TypeScript Client 1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2).
  Native `temporal worker list` showed the secondary shutting down with
  its prior successful poll still present while the primary ran on the
  same PID. A repeat at E2E runner revision `66c1efe` passed in 30.80
  seconds. Strict TypeScript, scoped formatting and lint, and
  `git diff --check` passed. Age-based expiry remains unverified.
