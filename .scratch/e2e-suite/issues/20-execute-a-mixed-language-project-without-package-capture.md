# 20: Execute a mixed-language project without package capture

**What to build:** Reused native SDK fixtures run in one mixed project without wrong-package registration, build resolution or Worker launch.

**Blocked by:** [02: Verify Go registration through a native Worker](02-verify-go-registration-through-a-native-worker.md), [03: Verify TypeScript registration through a native Worker](03-verify-typescript-registration-through-a-native-worker.md), [04: Verify Python registration through a native Worker](04-verify-python-registration-through-a-native-worker.md), [05: Verify Java registration through a native Worker](05-verify-java-registration-through-a-native-worker.md), [06: Verify .NET registration through a native Worker](06-verify-net-registration-through-a-native-worker.md), [07: Verify PHP registration through a native Worker](07-verify-php-registration-through-a-native-worker.md), [08: Verify Ruby registration through a native Worker](08-verify-ruby-registration-through-a-native-worker.md), [09: Verify Rust registration through a native Worker](09-verify-rust-registration-through-a-native-worker.md)

**Status:** ready-for-agent

**State:** resolved

Coverage groups: X01, X02, X03. Apply the [specification](../spec.md) and [coverage catalogue](../coverage-plan.md). Each case must name a Genesys defect and show its external effect. Record local commands, actual versions, results, and limits in the completion comment.

- [x] Compose the completed SDK fixtures into a mixed project; use each language only to exercise its distinct package/analyzer/emission/build path, not an all-pairs call matrix.
- [x] Check independent native names/scopes, full package context and matching generated/build artifacts for the selected Workers.
- [x] Use the existing Go/Python example as prior art for one actual cross-package call where generated identities or supplied contracts/converters could be lost.
- [x] Add another cross-package call only for a distinct Genesys integration risk. Do not introduce a mandatory schema, language queues or deployment placement.
- [x] All eight SDK package forms remain in scope, but report each unavailable local prerequisite explicitly and do not call a partially executed composition verified.

## Comments

- 2026-11-16. [The mixed-project cases](../../../e2e/20-mixed-project.test.ts)
  use the installed CLI and the immutable build manifest. The full case uses
  the existing Go, Python, TypeScript, Maven Java, .NET, Composer PHP, Bundler
  Ruby, and Cargo Rust fixtures in one published build and Temporal namespace.
  It checks package ownership, generated registration, native build outputs,
  launch working directories, and a real result from each selected Worker.
  These checks expose a build or launch plan that uses the wrong package,
  dependency, or generated registration.
- `pnpm test:e2e 20-mixed-project -t 'Go and Python'` passed on macOS 27.2.1
  arm64 with Go 1.27.4, Python 3.15.2, Temporal CLI 1.10.0 and Server 1.32.2,
  Node 26.13.1, npm 11.20.0, pnpm 12.17.0, Vitest 5.1.0, and packed gsys
  0.0.0. Both packages registered `Greeting` in independent scopes. The Go
  Workflow called the generated Python `ComposeGreeting` Activity and got
  `intercepted/Hello, Ada!`. A scratch run selected the existing
  `LegacyTransform` Activity instead and failed the result assertion with
  `ADA`.
- A separate installed `gsys dev` run of [the Go/Python example](../../../examples/mixed-workers/)
  returned `HELLO, ADA!` from
  `temporal workflow execute --type Greeting --task-queue greetings --input '"Ada"'`
  on a private endpoint and namespace. Both Workers and Temporal exited cleanly.
- `pnpm test:e2e 20-mixed-project -t 'all eight SDKs'` passed on Debian 13
  Linux arm64 in one local Docker container. The container used Go 1.27.4,
  Python 3.13.5, JDK 21.0.9 and Maven 3.9.11, .NET SDK 10.0.404,
  PHP 8.4.27 with cURL and sockets, Composer 2.11.2, RoadRunner 2025.1.5,
  Ruby 3.4.12 and Bundler 2.6.9, Rust and Cargo 1.99.1, and vendored
  protoc 31.1 with its standard includes. Temporal CLI, server, Node, npm,
  pnpm, Vitest, and packed gsys versions matched the macOS run. Debian's
  initial protobuf compiler installation lacked the imports needed by the
  Rust SDK. The retry supplied the vendored compiler and includes via
  `PROTOC` and `PROTOC_INCLUDE`. The full case served requests in all eight
  native packages and ran the additional Cargo target with its required feature.
- `pnpm exec tsc -p tsconfig.json`, scoped lint and formatting, Go formatting,
  and `git diff --check` passed. The full eight-SDK build and launch were
  verified on Linux arm64. A final run against product main is pending the
  product merge.

- 2026-11-16. Product baseline `main` at `2e61166`. `pnpm test:e2e 20-mixed-project`. Both cases passed on Debian Linux arm64 in local Docker with Node 26.13.1, pnpm 12.17.0, and Temporal CLI 1.10.0 (Server 1.32.2) after the Java fixture correction. A single mixed snapshot served native requests from all eight SDKs in one namespace. Go and Python retained independent equal Workflow names and executed the cross-package Activity.
