# Genesys local integration test specification

Status: ready-for-agent

## Problem Statement

Developers need evidence that Genesys discovers their native Temporal definitions correctly, generates usable registration, packages complete builds, and supervises Workers without losing required versions or stopping unrelated processes. Compilation and source review alone do not establish that these integrations work when the installed CLI runs a real application.

Reference provides useful test patterns, but many of its cases verify AI-agent features or runtime behavior that Genesys does not own. Copying those cases would add unrelated work and obscure the Genesys defects the suite must detect. Developers need locally runnable tests with explicit coverage limits, without CI infrastructure, a broad SDK/OS cross-product, or a separate simulation system.

## Solution

Provide a local integration suite that tests Genesys-owned discovery, generated registration, builds, packaging, and supervision. Every concrete test identifies the Genesys defect it would catch and the external observation that exposes it. Runtime tests execute Genesys-produced artifacts or Genesys-managed processes against real Temporal through native SDK interfaces.

Use Reference cases as risk references and test-method examples. Consolidate overlapping risks, add Genesys-specific coverage, and record exclusions. Select language, package, and platform variants only when they exercise a distinct Genesys integration risk. Activate tests with the implementation they verify and report missing or unrun coverage explicitly.

The primary test seam is the installed `gsys` CLI. Its process output, generated artifacts, native Worker execution, and lifecycle effects supply the observations. No new product execution interface or unconditional test hook is required.

## User Stories

1. As a developer, I want every test to name a Genesys defect, so that a passing suite provides evidence about the tooling I use.
2. As a maintainer, I want Reference cases mapped to applicable risks and exclusions, so that reference coverage does not create unrelated product requirements.
3. As a developer, I want tests runnable on my machine, so that I can reproduce failures without hosted execution or CI configuration.
4. As a developer, I want local prerequisites stated clearly, so that missing native tools do not appear as passing coverage.
5. As a maintainer, I want SDK variants selected by distinct Genesys code paths, so that test volume follows integration risk.
6. As a maintainer, I want OS variants limited to packaging, paths, native launch, and shutdown, so that the suite does not repeat unrelated runtime checks.
7. As a developer, I want the installed CLI tested outside its monorepo, so that missing packaged resources and workspace-only dependencies are detected.
8. As a developer, I want discovery checked across native package layouts and discovery roots, so that definitions are assigned to the correct package context.
9. As a developer, I want helper and native test files excluded from registration, so that source discovery does not expose unintended definitions.
10. As a developer, I want multiple definitions in one entry recognized, so that valid native source organization does not lose registrations.
11. As a developer, I want inspection to leave application code unexecuted, so that imports, constructors, factories, and build hooks cannot cause inspection side effects.
12. As a developer, I want native aliases, names, overrides, and visibility preserved, so that generated registration exposes the intended identities.
13. As a developer, I want file moves checked without renaming native definitions, so that source organization does not change caller contracts.
14. As a developer, I want conflicts checked within native registration scopes, so that independent Workers can reuse valid identities.
15. As a developer, I want invalid definitions, unresolved analysis, and SDK capability limits distinguished, so that I can choose the correct repair or native assembly.
16. As a developer, I want ambiguous Worker entrypoints reported, so that Genesys does not launch a guessed program.
17. As a developer, I want generated Workflows and Activities executed through native Clients, so that omitted registrations and wrong imports fail observably.
18. As a developer, I want generated callers and callees checked together, so that missing discovered child Workflow or Activity registrations are detected.
19. As a developer, I want application-owned instances and bound methods preserved, so that generated wiring does not lose receivers or dependencies.
20. As a developer, I want native dependency construction and visibility retained, so that generation does not invent constructor arguments or expose private definitions incorrectly.
21. As a developer, I want definition additions and removals checked through a new build, so that stale or missing generated registration is detected.
22. As a developer, I want generated and explicit native registration checked together, so that Genesys does not duplicate or replace authored registration.
23. As a developer, I want generated Workflow types and exports to retain native handlers and validators, so that emission does not omit or misclassify them.
24. As a developer, I want Nexus service identities, operation membership, and supplied instances preserved, so that generated service wiring remains usable.
25. As a developer, I want authored converters, interceptors, and relevant Worker options exercised through the build and launch path, so that packaging or supervision cannot silently replace them.
26. As a developer, I want failed candidate builds to preserve the selected successful build, so that analysis, generation, compilation, or publication failure does not break current execution.
27. As a developer, I want concurrent publication checked for complete selected manifests, so that consumers never select a partial candidate.
28. As a developer, I want source, dependency, lockfile, and package-setting changes included in new builds, so that snapshots do not use stale inputs.
29. As a developer, I want retained builds to keep their own source and dependencies, so that later edits cannot change their execution.
30. As a maintainer, I want equivalent registration inputs checked for reproducible generation, so that unrelated paths or enumeration order do not change registration output.
31. As a developer, I want snapshot links and generated outputs checked for ownership and isolation, so that builds cannot accidentally depend on external source or older builds.
32. As a developer, I want manifests to identify required outputs and provenance accurately, so that consumers can use complete immutable artifacts.
33. As a developer, I want build evidence to avoid publishing environment secrets, so that diagnosis does not expose credentials.
34. As a Python developer, I want native environments and entrypoints to stay at their final build paths, so that publication does not break embedded absolute paths.
35. As a developer, I want a new development session to start managed Temporal and all discovered Workers without prompts, so that interactive and noninteractive use have the same behavior.
36. As a developer, I want Worker selection checked, so that only the selected programs launch and unknown names fail clearly.
37. As a developer, I want executable overrides and Worker arguments preserved, so that launch uses the complete command I supplied.
38. As a developer, I want argument boundaries, order, colons, spaces, and shell characters checked, so that CLI parsing cannot alter or execute argument text.
39. As a developer, I want server arguments forwarded from the invocation working directory, so that relative native options retain their meaning.
40. As a developer, I want Worker commands to retain native package working directories and connection settings, so that server forwarding does not silently reconfigure applications.
41. As a developer, I want default temporary state and explicit database forwarding checked through Genesys, so that the CLI neither invents persistence nor damages an explicitly selected database.
42. As a developer, I want CLI help, version, JSON output, diagnostics, and exit status checked, so that installed command behavior is reliable for people and scripts.
43. As a developer, I want missing tools, bad commands, and occupied endpoints reported, so that failures remain visible and unrelated services remain intact.
44. As a developer, I want readiness observations attributed to the correct native Worker instances, so that a partial observation does not become a whole-program claim.
45. As a developer, I want a responding supervisor reused without another build or launch, so that a secondary invocation does not duplicate the development session.
46. As a developer, I want a secondary invocation to leave the owner running when it exits, so that supervisor reuse does not transfer lifecycle ownership.
47. As a developer, I want reconfiguration attempts against a reused session rejected, so that startup arguments cannot change an existing session silently.
48. As a developer, I want absent or unresponsive advisory endpoint records handled, so that stale records do not prevent valid startup.
49. As a developer, I want relevant source changes to trigger replacement without generated-output loops, so that watching neither misses edits nor rebuilds indefinitely.
50. As a developer, I want replacement built and started while the current Worker remains active, so that Genesys does not stop useful execution prematurely.
51. As a developer, I want the watcher to recover after initial and later build failures, so that repairing source can restore progress without concealing the failure.
52. As a developer, I want failed candidate startup to preserve the current Worker, so that a bad replacement cannot take down a working session.
53. As a developer, I want process creation, log text, and stale or misattributed polls rejected as readiness proof, so that Genesys cannot retire Workers on weak evidence.
54. As a developer, I want valid native observations reported with their limits, so that Genesys neither rejects useful evidence nor claims replay compatibility it cannot establish.
55. As a developer, I want required Worker versions and builds retained during replacement, so that Genesys does not remove a version that pinned executions still need.
56. As an operator, I want native routing and pinning controlled by native tools, so that supervision does not change deployment policy.
57. As a developer, I want missing, stale, incomplete, or contradictory retirement evidence to preserve the old Worker and build, so that uncertainty does not authorize removal.
58. As a developer, I want eligible retirement to wait for process exit and remaining build consumers, so that cleanup cannot delete a still-required artifact.
59. As a developer, I want graceful Worker shutdown to complete before managed Temporal stops, so that native shutdown can still contact the service.
60. As a developer, I want native shutdown settings respected, so that a Genesys deadline cannot truncate application shutdown.
61. As a developer, I want a second interrupt to terminate only owned process trees, so that I can stop an unresponsive session without affecting unrelated processes.
62. As a developer, I want real child and server failures to exercise Genesys cleanup, so that ownership leaks and suppressed failures are detected.
63. As a developer, I want mixed-language packages to keep their own analysis, registration, build, and launch context, so that one SDK cannot capture another package's definitions or dependencies.
64. As a developer, I want cross-package calls checked where generated identities or packaged contracts create an integration risk, so that wrong registration and missing shared dependencies are detected.
65. As a developer, I want independent package scopes checked for false collisions, so that identical native names do not become global conflicts.
66. As a developer, I want direct, Compose, and hybrid startup checked against published native builds, so that missing artifacts or launch settings are detected.
67. As a developer, I want compatible direct and container startup to reuse the same immutable build, so that hidden dependence on mutable source or writable artifacts is detected.
68. As a developer, I want platform-specific artifact selection and packaged assets checked, so that the installed CLI does not mix incompatible native outputs.
69. As a maintainer, I want repeated build and replacement cycles checked for duplicate launches, stale generations, and leaked resources, so that lifecycle regressions are detected without benchmarking Temporal.
70. As a maintainer, I want specific failures reproduced through real execution first, so that tests establish actual Genesys integration behavior.
71. As a maintainer, I want any simulation tied to a named defect and a documented reproduction limit, so that a new test subsystem is not added without need.
72. As a developer, I want local test resources isolated and cleaned up by their owner, so that tests do not interfere with my other work.
73. As a maintainer, I want failed local runs to retain relevant diagnostics and version information, so that failures can be investigated without publishing secrets.
74. As a maintainer, I want missing coverage linked to implementation tickets and tests activated with their implementation, so that coverage follows delivered behavior.
75. As a developer, I want skipped, unsupported, unavailable, and unrun cases reported separately from passes, so that incomplete local execution is not presented as verified support.
76. As a maintainer, I want runner limits to detect stalled tests without setting product speed targets, so that local runs terminate clearly without adding performance requirements.

## Implementation Decisions

- **Scope and acceptance.** Implement local correctness tests for Genesys-owned discovery, registration generation, builds, packaging, and supervision. Each concrete case records the operation under test, a named Genesys defect, and the external observation that would fail. Remove cases whose evidence concerns only Temporal or an Reference-only feature.
- **Primary seam.** Use the installed `gsys` CLI as the highest existing product boundary. Launch it as a real subprocess. Observe its outputs and generated artifacts, and use native Temporal Clients to exercise the resulting Workers. These observations support one public execution path rather than separate internal-module test APIs.
- **Static and runtime boundaries.** Inspection cases prove that discovery does not execute authored code. Runtime cases execute generated registration and complete published builds against real Temporal. A manually assembled application that bypasses Genesys cannot provide the sole integration proof.
- **Local runner.** Reuse the repository's TypeScript and Vitest tooling with the smallest process and fixture support needed by concrete cases. Make selected cases runnable locally with documented native prerequisites. Do not add product configuration, public runtime APIs, or general test extension points.
- **Native fixtures.** Use small deterministic applications with native Workflows, Activities, Nexus service handlers where supported, Clients, Worker entrypoints, dependency construction, and shutdown behavior. Temporal primitives are probes for Genesys defects, not independent conformance targets.
- **SDK selection.** Keep Go, Java, .NET, PHP, Python, Ruby, Rust, and TypeScript within the accepted language scope. Add variants for distinct analysis, emission, package, build, or launch paths. Preserve explicit native assembly for valid unresolved patterns and distinguish SDK capability limits from Genesys tooling limits.
- **Platform selection.** Limit OS-specific cases to Genesys-owned npm packaging, paths, native process launch, and shutdown. Do not run every case for every SDK and OS merely to populate a matrix. A combination needs a distinct integration risk.
- **Build correctness.** Exercise complete candidate publication, failure preservation, snapshot isolation, dependency resolution, reproducible registration, provenance, and retention. Preserve stable final native build paths. Do not require byte-identical native binaries, relocatable environments, or multi-file atomicity that the product does not promise.
- **Development lifecycle.** Cover native argument forwarding, selection, startup overrides, process ownership, supervisor reuse, watching, replacement, and recovery. Preserve the distinction between invocation working directory and native package working directory. Tests must not introduce new service-selection modes or rewrite Worker connection settings.
- **Readiness and retirement.** Keep native readiness evidence, replay compatibility, routing, and retirement eligibility separate. Verify Genesys's response to evidence and its retention decisions. Native tools retain control of routing and pinning. Explicit session shutdown remains distinct from automatic version retirement.
- **Real failure reproduction.** First use concrete local failures such as invalid native source, an invalid executable, a real program that does not poll, or termination of an owned child. Assert the corresponding Genesys failure handling. For unavailable retirement evidence, keep the session otherwise live; stopping managed Temporal exercises a different shutdown path.
- **Conditional simulation.** Add simulation only when a named Genesys defect cannot reasonably be reproduced through real execution. Record the native setup limitation or attempted reproduction, the required observation, and the smallest substitution and its limits. Prefer an existing observation boundary and a case-local substitution. No separate fault-simulation harness or new seam is justified in advance.
- **Isolation and cleanup.** Give each run its own mutable workspace and distinguish its ports, native identifiers, builds, and owned processes. Use native cleanup appropriate to the selected OS. Preserve relevant failure evidence and report cleanup failures without discarding the original error. Do not stop unrelated services or delete unowned artifacts.
- **Synchronization.** Use native observable state and explicit fixture barriers instead of fixed sleeps. Runner time limits detect stalls. They do not impose another Genesys shutdown deadline or numeric product performance requirement.
- **Evidence and activation.** Record selected and executed cases, exact versions, relevant native prerequisites, outcomes, and validation limits. Link missing coverage to product implementation tickets. Activate tests with the implementation they verify; resolved product tickets still require runtime evidence. Skips and unavailable prerequisites never count as verified support.
- **Publication scope.** This specification publishes the settled test design. It does not itself add test code, product code, CI configuration, or new product behavior.

## Testing Decisions

- **Good tests verify external behavior.** Prefer results observable through the installed CLI, public generated artifacts, native Client calls, or owned process lifecycle. Avoid assertions about private function calls, incidental file structure, internal call order, or implementation details that do not express a product contract.
- **Every test needs a Genesys defect.** For each fixture and parameter variant, explain what Genesys could break and what fails observably. If removing Genesys operations and generated artifacts leaves the same evidence, the case is likely a Temporal-only test and must be excluded. This is a review rule, not a requirement for mutation testing or a duplicate native-only suite.
- **Tested responsibilities.** Cover source discovery and SDK analysis; native registration generation and dependency wiring; build publication, manifests, isolation, and retention; installed package resource resolution; CLI arguments and diagnostics; supervisor reuse and replacement; readiness interpretation; retirement decisions; native process ownership and shutdown. The supporting catalogue contains 51 groups with explicit defect statements.
- **Runtime evidence is real.** Execute actual Genesys-produced registration/builds or managed processes against local Temporal. Use native results and history only to demonstrate the Genesys integration outcome. A healthy server, a successful build, or a workflow count alone is not sufficient proof of the intended integration.
- **Retirement failure example.** When required native retirement evidence is unavailable, assert that Genesys retains the old Worker and its build and reports uncertainty. Do not test whether Temporal computes correct retirement evidence. If that input cannot reasonably be produced through a real local setup, document the specific limit before considering simulation.
- **Native registration variants.** Exercise the language-specific forms that Genesys analyzes or emits: functions and receiver methods, annotated interfaces and implementations, attributes and partial types, decorated functions and classes, native definition objects, private module-local macros/includes, and callable exports or Activity maps. Native handlers, construction, visibility, aliases, and name overrides remain application-owned.
- **Cross-language scope.** Select packages and calls that expose a generated identity, package boundary, shared contract, converter, build, or launch risk. Do not add a general cross-SDK payload compatibility suite or all-pairs call matrix.
- **Prior art.** Reference's packaged consumer and CLI scenarios provide patterns for installed artifacts and process-visible errors. Its build isolation and generation-change scenarios provide patterns for complete publication and retained code identity. Its restart scenarios provide synchronization methods for pending work during Genesys lifecycle operations; they do not justify a standalone Temporal crash-durability suite. Its barrier-based stress cases inform deterministic coordination, not performance requirements.
- **Reference accounting.** The inspected Reference sources contain 368 eval files and 374 exported cases across 41 fixtures. The retained map uses 45 files as partial risk references and excludes 323 files. These are source-analysis counts, not passed tests or a required Genesys test count. Adjacent scenarios and support tests are documented separately.
- **Local results.** Distinguish passes, failures, skips, missing tools, unsupported features, unimplemented cases, and environments not exercised. State the actual SDK, Temporal, toolchain, platform, and package versions used. Do not claim coverage of other combinations from one successful local run.
- **Evidence collection.** Keep the case-relevant exit status, stdout/stderr, diagnostics, manifests, native execution evidence, process information, and cleanup result needed to diagnose a failure. Redact secrets. Do not add an independent telemetry, benchmark, or reporting service.
- **No current execution claim.** This publication was validated as a specification and coverage record. No tests, application Workers, Temporal services, or deployments were run by this work.

## Out of Scope

- CI workflows, PR gates, scheduled runs, hosted test execution, and release gates.
- Separate benchmarks, performance reporting systems, throughput tests, and numeric speed targets.
- A full SDK-by-OS cross-product without distinct Genesys-owned integration risks.
- Temporal internal correctness, including its retry, timeout, replay, cancellation, durability, routing, retirement-evidence, or serialization algorithms.
- One-for-one equivalents of Reference cases or preservation of Reference's test count.
- Reference model behavior, agent tools, approval policies, memory, channels, sandbox providers, skills, TUI, operational UI, or cloud-world adapters.
- A separate fault-simulation harness, synthetic Temporal implementation, or speculative test seam.
- A new Genesys runtime, Worker configuration model, public execution API, required authored startup script, or mandatory contract schema.
- Changes to native routing/pinning policy or automatic retirement based on readiness alone.
- New guarantees for build relocation, byte-identical native binaries, exclusive supervisor ownership, automatic crash restart, or fixed native shutdown deadlines.
- Product or test implementation as part of publishing this specification.

## Further Notes

This specification consolidates the settled interview and is published to the local tracker with `ready-for-agent` status. The explicit publication request requires no further interview or seam approval: the public CLI and native execution boundary implement the already agreed Genesys-only integration scope. No new seam is proposed.

The prior project's no-test restriction remains historical context. The subsequent request explicitly scoped this test specification. Existing implementation tickets retain their statuses and evidence; this publication does not mark any test coverage complete.

The glossary remains authoritative. The accepted architecture decisions preserve native Temporal interfaces and separate Worker readiness from retirement eligibility. This test design verifies those boundaries rather than changing them.

At the implementation snapshot used for this publication, product tickets 01–17 were resolved and ticket 18 remained open. Their build and review evidence did not establish end-to-end runtime compatibility. Check the relevant ticket and implementation when activating each test; do not treat this snapshot as a permanent feature-status claim.

Supporting records:

- [Coverage catalogue: 51 groups and their Genesys defects](coverage-plan.md)
- [Coverage dependencies linked to implementation tickets](coverage.md)
- [Reference source analysis and validation limits](analysis.md)
- [Complete source-to-risk mapping and exclusions](reference-map.md)
- [Case IDs, assertion evidence, guards, and limitations](reference-cases.json)
- [Reference harness and adjacent scenario evidence](reference-harness.md)
