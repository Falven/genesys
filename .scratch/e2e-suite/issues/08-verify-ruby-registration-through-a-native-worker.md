# 08: Verify Ruby registration through a native Worker

**What to build:** A real Ruby application detects lost definitions, changed identities, broken construction, and incorrect native build/launch through Genesys.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: D01, D02, D03, D04, D05, D06, D07, R01, R02, R03, R04, R05, R07, R08. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use a small Ruby native application to exercise native definition classes/objects, aliases and supplied Activity instances, literal package imports and executable conventions; every selected variation must have a distinct Genesys analysis/emission/build/launch risk.
- [x] Inspect without executing application imports, constructors, or build hooks where that analyzer is at risk. Check multi-definition entries, native identities, scope-local conflicts, entrypoint ambiguity, and unresolved versus invalid/capability diagnostics using focused source changes.
- [x] Build and execute generated registration through the installed CLI. Prove application-owned construction and a representative generated Workflow handler remain usable. Exercise supported Nexus emission through native service execution; an absent SDK API gets an explicit capability diagnostic instead of fabricated registration.
- [x] Add/remove a definition and combine generated with explicit native assembly to catch stale output, omission, and duplicate registration. Use only applicable distinct forms, not a primitive conformance battery.
- [x] Preserve native dependency/options modules in the published build where this SDK has a distinct packaging risk. Leave a reusable native fixture for mixed-package testing.
- [x] The reviewed SDK evidence does not establish Nexus service-handler registration; verify the supported capability for the fixture version and cover the Genesys diagnostic when absent, without a simulated Nexus service.

## Comments

Implemented two focused cases in [08-ruby.test.ts](../../../e2e/08-ruby.test.ts) with a reusable [native Ruby package](../../../e2e/fixtures/ruby).

- D01–D07. Installed `gsys inspect` keeps application imports, the Activity constructor and the Gemfile inert. It finds multiple native definitions and the nested Gemfile package while excluding helper and test definitions. A literal alias and override survive a file move. Two literal Worker scopes can share a name across scopes. A collision within one scope and ambiguous `bin` candidates report both sources. Computed identity, invalid Ruby syntax and unavailable SDK capability get distinct diagnostics.
- R01–R05, R08. Installed `gsys build` publishes two immutable manifests. Their Bundler commands start the matching extensionless Worker from its snapshotted package. The Ruby Client invokes a generated Workflow by native name and sends its authored Signal. The result uses the supplied Activity instance, the generated native `Definition::Info`, and the explicit native Activity with the authored interceptor. The old and new Workers each serve their expected Workflow after a definition replacement and removal of the authored interceptor module.
- R07. The installed `temporalio` 1.11.0 Worker constructor exposes no Nexus service registration parameter. A Nexus discovery entry produces `ruby.sdk-nexus-unavailable`.

Ran inside a Linux arm64 Ruby 3.4 container with the checkout mounted at `/workspace`. Versions were Ruby 3.4.12, Bundler 2.6.9, temporalio 1.11.0, Temporal CLI 1.10.0 with Server 1.32.2, Node 26.13.1, npm 11.20.0, pnpm 12.17.0, and gsys 0.0.0.

```sh
docker exec genesys-ruby-e2e-08 pnpm install --frozen-lockfile
docker exec genesys-ruby-e2e-08 pnpm test:e2e 08-ruby
docker exec genesys-ruby-e2e-08 pnpm exec tsc --noEmit
```

Both Ruby tests and the type check passed. macOS and Windows execution remain unverified. The initial run exposed native Bundler and Ruby messages ahead of the build JSON on stdout. This case reads the published manifests for the launch contract.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 08-ruby`. Both cases passed on Debian Linux arm64 in local Docker with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with Ruby 3.4.12 and Temporal Ruby SDK 1.11.0.
