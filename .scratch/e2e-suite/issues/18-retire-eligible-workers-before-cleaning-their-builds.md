# 18: Retire eligible Workers before cleaning their builds

**What to build:** Genesys retires only an eligible old Worker and removes its build only after owned processes and required consumers are finished.

**Blocked by:** [17: Retain required versions when retirement is unsafe](17-retain-required-versions-when-retirement-is-unsafe.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: V04, P01, L01. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Exercise the shipped eligible unversioned Go Worker shape and verify retirement timing and selection with native state.
- [x] Cover eligible unversioned replacement here and link protected versioned or unresolved cases to ticket 17.
- [x] Verify build retention with a live Worker sharing the snapshot. Link protection for closed pinned Queries and owned descendants to tickets 17 and 19.
- [x] Repeat replacement/retirement a bounded number of times and distinguish justified retained builds from orphaned processes or unreferenced owned candidates.

## Comments

- 2026-11-16. The scenario passed provisionally with
  `pnpm test:e2e 18-native-retirement-cleanup` at `9bc75f2` after merging E2E
  integration commit `92f7348`. The final run against
  merged product is pending. Local versions were macOS 27.2.1 arm64, Node
  26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, packed `@genesys/cli`
  0.0.0, Go 1.27.4, Temporal Go SDK 1.51.0, Temporal TypeScript Client
  1.25.0, and Temporal CLI 1.10.0 (Server 1.32.2). `pnpm exec tsc --noEmit`,
  scoped formatting and lint, and `git diff --check` passed.
- `pnpm test:e2e 18-native-retirement-cleanup` runs two successive replacements
  through installed `gsys dev`, native Go Workers, and local Temporal. It
  uses the unversioned Go example because the checked retirement path is
  limited to native unversioned Go replicas. Native Workflow and non-eager
  Activity history identify both kinds of tasks by Worker PID. A retirement
  before attributed replacement readiness or a leaked replaced process fails
  the case.
- The first build owns a second Worker on a separate Task Queue. The case
  removes that entrypoint but confirms its old PID can still execute its
  Workflow and Activity after the first replacement. The original build
  must remain available while that Worker runs. The second build has only
  the replaced Worker and must disappear during the live session. After
  owner shutdown the first build must disappear and the third manifest
  must stay selected.
- Different-version retirement, closed pinned Queries on a retired version,
  and cleanup with a descendant in the retired Worker group remain open.
  The checked unversioned path uses a single-process Worker. Ticket 19
  separately exercises descendant-aware native session shutdown.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 18-native-retirement-cleanup`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with `CGO_ENABLED=0` and Go SDK 1.51.0. Both checked unversioned Go replacements retired. Their process-exit and build-selection checks passed. The build with another live Worker stayed available until that Worker exited. Product main conservatively retains versioned and unresolved programs. Ticket 17 covers a retained closed pinned Query and ticket 19 covers descendants during session shutdown. Positive versioned retirement and automatic retirement of a group with descendants are outside the shipped eligibility subset.
