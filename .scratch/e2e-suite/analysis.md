# Reference analysis and Genesys adaptation

Reference identifiers, paths, and quoted excerpts use neutral names throughout these research records.
Source hashes describe the original inputs, not the redacted excerpts.

The inspected Reference suite has **368 eval files, 374 exported cases, and 41 fixtures** when both CI discovery roots are included. The published Genesys specification has **51 correctness groups** for local execution. SDK, platform, and deployment variants must expose distinct Genesys-owned defects; there is no full SDK/OS cross-product. This is a coverage design, not a claim that the tests run or pass.

## Review artifacts

- [Published Genesys specification](spec.md)
- [Coverage catalogue and named Genesys defects](coverage-plan.md)
- [Every Reference eval file and proposed disposition](reference-map.md)
- [Case IDs, assertion evidence, guards, and limitations](reference-cases.json)
- [Coverage linked to implementation tickets](coverage.md)
- [Harness, CI, support tests, and adjacent scenarios](reference-harness.md)

The source audit covered every eval file, fixture/mock configuration, relevant helpers, CI discovery and workflows, and the most relevant CLI/build/dev/packaging scenarios outside the eval directory. It did not audit all of Reference's unit/integration suite or execute any suite. Q1 is settled: each retained proposal must name a Genesys-owned defect. The map's dispositions are risk references, not Reference API equivalents or a Temporal conformance suite.

## Reference inventory and execution configuration

The CI descriptions below explain what Reference runs. They are reference evidence only. Genesys tests are locally runnable; this plan adds no CI workflows, PR gates, scheduled runs, or release gates.

| Measure | Count and meaning |
| --- | --- |
| Root `e2e/fixtures` | 40 eval-owning fixtures, 367 `.eval.ts` files, 373 exported cases |
| Additional CI fixture | `apps/fixtures/datadog-eval-reporter`: one fixture, file, and case |
| Full CI discovery sources | 41 fixtures, 368 files, 374 cases |
| Local/model matrix | 57 jobs, including three optional jobs; a job can run real-model and mock passes |
| Vercel matrix | 14 selected fixture jobs; deterministic models, real deployment infrastructure |
| Postgres matrix | 30 fixture jobs; deterministic models, real production server and database |
| Support tests within `e2e` | 26 declared cases in five files; not eval cases |
| Colocated test-file sentinel | `agent-tools/agent/tools/dynamic-schema-validation.test.ts` deliberately throws if discovery loads it; not another executable test suite |

Counts came from source enumeration, exported array inspection, and the read-only CI discovery script. They are not execution counts. The complete source set has no missing or duplicate inventory rows. Six files export two cases each: `workspace-credentials-cancel`, `parallel-review`, `ends-turn-function`, `dynamic-skill-context`, `subagent-hook-context`, and `pending-approval-tool-followup`. Canonical IDs come from paths; array entries add `/0000` and `/0001`. In-test loops do not create extra registered cases.

CI scans file IDs and literal tag text without importing case definitions. The runtime imports definitions and filters each case. These are different coverage boundaries. Local Genesys result reporting must distinguish selected and executed cases; skips and unavailable prerequisites are not verified support.

## What the suite establishes

Reference's strongest reusable approach is a small application fixture, a real CLI/server boundary, a deterministic responder where model behavior is irrelevant, and assertions on observable results. Separate model and infrastructure jobs avoid mixing provider variability with deployment correctness. Genesys can use deterministic native Workflows and Activities with real Temporal in the same role.

The 40 root fixture families cover basic runtime, cancellation, channels, compaction, custom skills, decision scoring, deferred tools, dynamic models, MCP, memory, native web search, OpenAPI, approval projection, prompt cache, routing, schedules, self-modification, limits/timeouts, skills, subagents, tasks, tool discovery/stubs, static/dynamic tools, human interaction, sandbox tools, workflow stress, workflow tools, bundled modules, and extensions. Most literal contracts belong to an AI-agent framework. Genesys does not provide that framework.

The revised source map has 45 partial risk references and 323 exclusions after applying Q1. These counts describe the draft mapping policy. They do not reduce Genesys's accepted scope. Retained risks concern generated registration, packaged dependencies, code-version isolation, Genesys build/replacement recovery, owned process cleanup, and deployment artifacts. Every target group now has a Genesys defect statement. Generic primitive, durable restart, cancellation, and throughput tests are excluded; real native work serves only to expose faults in Genesys-owned operations. Genesys needs additional discovery, multi-language, process ownership, and version-retirement tests that Reference cannot supply.

The relevant adjacent scenarios are particularly valuable:

- `local-workflow-restart-recovery`: kills the real server after a timer is persisted, restarts it, and completes the same session. Use its synchronization method within Genesys build/version-retention or lifecycle tests. A standalone Temporal crash-durability test is excluded.
- `dynamic-tool-resume` and `dev-server-workflow-generations`: preserve pending work and the intended code generation across source changes and process failure. Adapt only to Genesys selecting the correct immutable build and retaining required Workers/builds; do not retest replay/version routing algorithms.
- `production-build-isolation`: concurrent builds and failed builds preserve usable output. Adapt to Genesys's isolated candidate and atomic selector publication.
- CLI, packed-host, installed-extension, runtime dependency, and output scenarios: validate installed artifacts and process-visible errors. Adapt to the packed `gsys` executable and bundled SDK analysis helpers.
- Harness setup/teardown cases: preserve original failures, close owned resources, and retain recovery evidence. Treat these as harness checks, not native runtime proof.

## Assertions that need careful interpretation

1. The image attachment eval tells the model the image is a cat. It checks the structured image payload and response, not independent image recognition.
2. Approval projection uses supplied text containing pending approvals. It does not establish a real approval lifecycle.
3. Some real-model-tagged evals call source helpers directly. A tag does not prove HTTP or deployment coverage. `agent-tools/evals/channel-events/batched-delivery.eval.ts` directly tests payload coalescing.
4. Subagent self-modification routing cases assert delegation, not successful generated extension installation. Dedicated self-modification fixtures provide stronger evidence.
5. The escalation deadline eval drives the human-answer branch; its ten-minute timeout branch is not exercised.
6. Stress cases record timings without hard performance thresholds. Fifty sessions with two turns and one hundred sequential turns do not prove crash recovery.
7. The parallel-tools stress case uses a barrier that requires ten calls to overlap. This is stronger concurrency evidence than elapsed time alone.
8. Slack timing uses a stub Web API and begins after the receiving server is running. It is not a live Slack or instance cold-start measurement.
9. The deterministic judge fixture checks scoring adapter behavior, not provider judgment quality.
10. Datadog smoke checks successful agent execution. Its conditional reporter setup and lack of a delivery assertion do not prove Datadog reporting.
11. Postgres workflow row presence proves adapter use. It does not prove a workflow survives a crash. The workflow also permits zero executed evals after filtering and then accepts build/boot/health evidence.

## Conditional coverage and harness risks

Nine eval files contain explicit skips. They depend on deterministic model scripts (channel hand-off, pending-generation cancellation, lazy authorization), Anthropic-specific web search behavior, local dev routes (three schedule cases), Vercel alias/credentials for redeploy, or `REFERENCE_E2E_TAKO=1` for a temporarily disabled flaky case. Seventeen files also call a shared mock-model requirement helper. Source contains 119 real-model-tagged root eval files, seven files using soft assertions, and four files with direct judge calls. None of these counts alone proves a selected CI pass runs every assertion.

Other important source findings:

- Reference root `AGENTS.md` restricts E2E to CI; its README gives local real/mock commands. This is a documentation conflict, not proof that local execution is technically impossible. No E2E was run during this review.
- README describes `e2e.localOnly`; the current discovery code selects worlds through `e2e.worlds` and does not read that property. No current use of the stale property was found.
- Root `test:e2e` and CI do not select exactly the same fixture set. Datadog has `eval`, not `test:e2e`.
- Root eval jobs run on Ubuntu. Windows integration coverage is a different tier; there is no macOS eval lane.
- Optional model jobs can fail without failing the aggregate. Do not copy that policy to required native SDK support claims.
- Failure artifacts normally expire after seven days; ordinary successful JUnit output is not uploaded by those failure-only steps.
- E2E workflows lack explicit full-job timeout and matrix-concurrency bounds. Per-eval limits do not bound installation or deployment.
- Vercel workflow source has no explicit deployment/alias deletion. Some scenario temporary-directory cleanup errors are suppressed. Genesys should report leaks and clean only resources the run owns.

## Genesys-specific boundaries

The plan must not copy Reference's one-second shutdown expectation: Genesys explicitly waits for native Worker shutdown settings. It must not copy relocatable-build assertions: Python environments and other native outputs can require their original absolute paths. It must not copy framework-managed routing or state: Genesys leaves these with Temporal and application code.

Readiness is especially important. A successful workflow result can prove that particular execution worked. It does not prove every Worker instance and task type is ready, nor that previous versions can retire. Tests must separately check fresh attributed polling, unknown coverage, native deployment state, pinned executions, and retained builds.

The original spec covers all eight SDKs and three operating systems. At the initial audit commit, selectors, reuse, replacement, retirement, and mixed-language integration were pending. The checkout has since advanced to `e46d1e0c2e27dd1849c09e1eb647bb193705be09`; tickets 01–17 are now resolved and ticket 18 remains open. Their recorded compilation/review is not runtime test evidence. [Coverage dependencies](coverage.md) records the current implementation links. OS variants remain limited to Genesys packaging, paths, native launch, and shutdown risks.

## Settled plan decisions

Q1 is settled: every retained case names a Genesys integration defect and uses real Temporal execution where runtime proof is needed. Q2 is removed: all tests are locally runnable, with no CI workflows, PR gates, or scheduled runs. OS variants cover only distinct Genesys-owned packaging, path, native launch, and shutdown risks.

Q3 is settled: reproduce specific Genesys failures with real execution first. For example, missing retirement evidence must cause Genesys to retain its old Worker and build. Checking whether Temporal calculates correct evidence is outside scope. Simulation requires a named defect and a documented reason that the real setup cannot reasonably reproduce it; no separate simulation harness is planned.

Q4 is settled: activate tests with the implementation they verify and track missing coverage against its ticket. Skips never verify support. Q5 is settled: exclude separate benchmarks, performance reporting systems, and numeric speed targets. Use only local runner time bounds needed to report stalls, without changing native shutdown behavior. No planning decisions remain unanswered. The user requested publication through to-spec; the specification is now ready-for-agent. This publication adds no test or product implementation.
