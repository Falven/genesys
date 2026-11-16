# 07: Verify PHP registration through a native Worker

**What to build:** A real PHP application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small PHP native application to exercise native attributes and interfaces, grouped identities, Composer autoload, factory construction and RoadRunner/PHP process launch; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.
- [x] The reviewed SDK evidence does not establish Nexus service-handler registration; verify the supported capability for the fixture version and cover the Genesys diagnostic when absent, without a simulated Nexus service.

## Local run

Run `pnpm test:e2e 07-php` after `pnpm install --frozen-lockfile`. Put
PHP 8.4.1 or later with sockets, Composer, RoadRunner with its Temporal plugin,
Temporal CLI, and `ps` on PATH. The fixture uses its Composer lockfile.
In Docker, run the case, its installed CLI, and its managed processes in the
same Linux container with Linux workspace dependencies.

Copy [the PHP fixture](../../../e2e/fixtures/php/) into a standalone or mixed
project. Its Worker polls `genesys-php`. Send `php.release` to `php.greet`
to complete the Workflow. Set `GENESYS_PHP_REGISTRATION` to the corresponding
absolute registration artifact from the selected build when using the fixture
inside a larger project. Set `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and
`GENESYS_PHP_RPC_PORT` for the selected service and RPC port.

## Comments

- 2026-11-16. `pnpm test:e2e 07-php` passed in an isolated Linux arm64
  Docker container with PHP 8.5.12, Composer 2.11.2, PHP SDK v2.20,
  RoadRunner 2025.1.5, Temporal CLI 1.10.0 (Server 1.32.2), TypeScript
  Client 1.25.0, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  and npm-installed `@genesys/cli` 0.0.0. The container combined the PHP
  Composer image with sockets, Node from `node:26.13.1-alpine`, RoadRunner
  from `ghcr.io/roadrunner-server/roadrunner:2025.1.5`, and Temporal CLI
  from `temporalio/temporal:1.10.0`. It installed procps and Linux pnpm
  in the container.
- Installed inspection resolved a shared Workflow file, preserved grouped
  Activity names and the moved Workflow name, and left application and
  Composer markers absent. It reported conditional native assembly,
  an invalid Workflow declaration, RoadRunner config ambiguity with both
  candidates, and the SDK's absent Nexus handler capability. Reflection
  confirmed the published v2.20 Worker interface had no Nexus registration
  method.
- Build rejected the same name in one scope and published it in a separate
  scope. The next published build removed the obsolete Workflow and added
  its replacement. `gsys dev` launched RoadRunner in the published Worker
  directory. The Client sent `php.release` and received
  `intercepted: factory Genesys!`. Workflow history recorded the authored
  Worker identity. The explicit and added Workflows returned `explicit`
  and `added`. The managed session exited with code 0 after SIGINT.
- A disposable product mutation replaced the authored Activity factory
  with generated construction. The same case failed because the real
  Worker returned `intercepted: lost factory Genesys!`. TypeScript
  compilation, scoped lint and formatting, and `git diff --check` passed.
  Other platforms and SDK versions were unrun.
- 2026-11-16. On product main `2e61166`, the previous collision check
  failed because `gsys build` exited 0. The updated case checks for
  `warning php.generated-scope-collision` and verifies that the published
  manifest and the directory scanned by the PHP Worker contain no
  registration artifact for the ambiguous scope. Moving the duplicate
  to a separate discovery root produces two registration artifacts.
  `pnpm test:e2e 07-php` passed on Linux arm64 with PHP 8.4.27, Composer
  2.11.2, PHP SDK v2.20, RoadRunner 2025.1.5, Temporal CLI 1.10.0
  (Server 1.32.2), Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0,
  and packed `@genesys/cli` 0.0.0.
