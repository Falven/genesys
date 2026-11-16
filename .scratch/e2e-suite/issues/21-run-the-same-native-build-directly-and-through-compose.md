# 21: Run the same native build directly and through Compose

**What to build:** Local direct, Compose and hybrid execution detects incomplete artifacts and hidden dependence on mutable source.

**Blocked by:** [01: Execute a Go Workflow through the installed CLI](01-execute-a-go-workflow-through-the-installed-cli.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: E01, E02. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Use the existing native Go deployment example as prior art; start the published native Worker directly and through local Compose/hybrid arrangements.
- [x] On compatible Linux architecture, execute the same immutable build at its original absolute path through a read-only mount.
- [x] Change authored source and verify that the selected build still supplies its own implementation.
- [x] Use platform-specific rebuilt binaries where required; do not claim cross-OS binary reuse or introduce a gsys service-selection flag. Clean only owned test resources.

## Comments

[The deployment case](../../../e2e/21-native-deployment.test.ts) runs the native Go example built by the installed `gsys`. The Workflow invokes the generated Activity registration. The Activity returns its compiled greeting and reads a data file relative to the native working directory.

- E01. The macOS Worker from the selected manifest served the Workflow with the local Temporal process and with a Compose-owned server. The hybrid call returned the published greeting and data after both changed in the authored project.
- E02. The same Linux arm64 build served the Workflow through direct Docker Engine startup and through Compose. The Compose container used the original absolute executable and working directory from the manifest. Docker reported a read-only bind mount at the original absolute build path. The Linux authored Activity and data changed between the calls. The Compose Workflow still returned `Hello, Compose! published`. The immutable manifest and native executable hash matched after both starts.
- A deliberate probe removed only the data file from the throwaway Linux snapshot after direct startup. The Compose Worker polled and started the Activity. The Workflow failed with `open deployment-version.txt: no such file or directory`. The probe was removed. Its test project left no containers, networks, or generated image tags.

The initial case passed on macOS 27.2.1 arm64 and Docker Engine 29.9.3 Linux arm64 with Docker Compose 5.7.0. Both build paths used Node 26.13.1, npm 11.20.0, Go 1.27.4, packed gsys 0.0.0, and Go SDK 1.51.0. The host runner used pnpm 12.17.0, Vitest 5.1.0, and Temporal TypeScript Client 1.25.0. Both servers used Temporal CLI 1.10.0 and Server 1.32.2. The Linux runtime image was `alpine:3.22` and the server image was `temporalio/temporal:1.10.0`.

```sh
pnpm install --frozen-lockfile
pnpm test:e2e 21-native-deployment
pnpm exec tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --skipLibCheck --types node e2e/21-native-deployment.test.ts e2e/fixture.ts
pnpm exec oxlint e2e/21-native-deployment.test.ts e2e/fixture.ts
pnpm exec oxfmt --check e2e/21-native-deployment.test.ts e2e/fixture.ts
```

Run with host Go and Temporal CLI on `PATH`, and a local Linux Docker engine with `docker compose` and filesystem access to the host temporary directory. Image, npm, and Go dependency downloads may require registry access. Runtime evidence is from the two stated arm64 environments. Final validation against the product merged to `main` is pending.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 21-native-deployment`. Passed on macOS 27.2.1 arm64 with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) with a local Linux arm64 Docker Engine and Compose after the review fixes. Direct, Compose, and hybrid startup served real native results. Linux direct and Compose consumed the same immutable build at its original absolute path.
