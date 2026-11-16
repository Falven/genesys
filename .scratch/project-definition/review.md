# Final review corrections

Base: `f7afcb576e4ed7bad4eefec9ccae625d186b4065` on `codex/genesys-integration`.
Correction branch: `codex/genesys-review-fixes`.

The 13 findings were confirmed by source review. The unsafe behavior is corrected.
The later bounded Go coverage section supersedes the initial blanket retention
limit. Ticket 15 is resolved for that supported subset; opaque/versioned programs
remain retained.

| Finding                                  | Correction                                                                                                                                                                                                                                                                                                                                                                                  | Evidence and limits                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standards 1: rejected process completion | The replacement completion handler reports ownership failure and requests session shutdown. It does not mark the generation ended or release its build.                                                                                                                                                                                                                                     | CLI compilation and static review of both promise branches. No helper-failure session.                                                                                                                                                                                                                                     |
| Standards 2: recycled POSIX group ID     | A bundled Node anchor remains the group leader while native descendants live. Shutdown goes over IPC; only that live anchor signals its own occupied group. Parent code never signals a saved PGID.                                                                                                                                                                                         | Compiled helper included in npm tarball. Static review covers leader exit, build descendants, enumeration errors, IPC loss and force termination. No live process sessions. Forced anchor death cannot confirm completion; builds remain retained. Descendants that deliberately leave the group remain outside ownership. |
| Standards 3: managed SQLite input        | Explicit `--db-filename` values resolve from the original invocation cwd. The database and `-wal`, `-shm`, `-journal` sidecars are excluded from watches and development snapshots. Canonical DB/parent paths cover symlink aliases; Windows path matching is case-insensitive. Server argv is unchanged.                                                                                   | CLI compilation and static review through session, watcher, build job and snapshot. No Temporal writes or live watch session.                                                                                                                                                                                              |
| Standards 4: private source exposure     | The candidate version parent is created with mode `0700` before any source copy. Source modes remain inside that private boundary.                                                                                                                                                                                                                                                          | Native Go/Java builds published candidates beneath the private parent; source review confirms creation precedes snapshot. Host ACL policy remains native.                                                                                                                                                                  |
| Standards 5: Go argv limit               | The Go inventory is decoded from stdin, rather than serialized into an argv element.                                                                                                                                                                                                                                                                                                        | Native analyzer compilation and installed-package Go build. No synthetic large-inventory harness.                                                                                                                                                                                                                          |
| Standards 6: Rust temporary targets      | One analysis owns its isolated Cargo directory and removes it in `finally` after success/failure. Emission reuses the parsed analysis, so it does not compile the helper again.                                                                                                                                                                                                             | Installed-package static Rust inspection compiled the helper; manual listing showed the dedicated TMPDIR empty after completion. Abrupt process termination cannot execute `finally`; ownership-loss cleanup remains withheld.                                                                                             |
| Standards 7: duplicate .NET analysis     | Emission reuses the paired analysis result through a WeakMap, matching the Go adapter lifecycle.                                                                                                                                                                                                                                                                                            | CLI compilation and static review. The unchanged Roslyn helper was not rebuilt for this correction.                                                                                                                                                                                                                        |
| Spec 1: incomplete retirement coverage   | Snapshot heartbeats no longer authorize program-wide retirement, including same-version replicas. Native readiness observation remains separate from the coordinator's retirement gate.                                                                                                                                                                                                     | Unsafe eligibility paths removed. Native enumeration has no complete coverage evidence for arbitrary programs. Ticket 15 is reopened; all previous programs remain until explicit session shutdown.                                                                                                                        |
| Spec 2: Drained/closed-only removal      | Historical Drained and closed-only reachability no longer authorize removal. Retention diagnostics state the pinned-override and closed-Workflow Query limits.                                                                                                                                                                                                                              | Source review and existing native API evidence; no server or Workflow sessions.                                                                                                                                                                                                                                            |
| Spec 3: handler registrations            | Go resolves native Query/Update handlers and validators through compiler symbols, declarations and assignments. TypeScript resolves `setHandler` handlers, validators, const aliases, shorthand options and re-exports through compiler symbols. Those references are excluded from automatic registration. Explicit native assembly remains intact; static ambiguity produces diagnostics. | Go analyzer compilation, CLI compilation, source inspection against installed Go SDK 1.51.0 and TypeScript SDK API evidence. No new handler fixtures or runtime checks. Dynamic factories/control flow remain native assembly limits.                                                                                      |
| Spec 4: aggregate collisions             | Java and PHP warn and omit ambiguous optional aggregates. Explicit assembly on independent native registries can still build. A consumer that continues to reference an omitted Java aggregate fails its native compilation; PHP retains native missing-file behavior.                                                                                                                      | Compiler/type checks and static review. No collision harness.                                                                                                                                                                                                                                                              |
| Spec 5: executable fallback              | Unresolved named Go/Java Workers remain in build plans without an inferred start command. Native package cwd and native compile commands remain available to explicit startup overrides. Shared SDK normalization now preserves an adapter's explicit cwd. Genuine native source errors still fail.                                                                                         | CLI and native analyzer builds; static trace through build and Worker selection. No startup sessions.                                                                                                                                                                                                                      |
| Spec 6: Java construction                | Removed the constructor convenience overload. Generated registration takes every application-owned Activity/Nexus instance explicitly.                                                                                                                                                                                                                                                      | Installed-package native Maven build of the existing Java sample, with its authored call updated to pass those instances. No main method was run.                                                                                                                                                                          |

## Checks run

- Dependency installation: Node `26.13.1`, `pnpm install --ignore-scripts --frozen-lockfile`.
- CLI: `pnpm --filter @genesys/cli typecheck` and `pnpm --filter @genesys/cli build`.
- Formatting/lint: scoped `pnpm exec oxfmt`, `pnpm exec oxlint packages/genesys/src`, `gofmt -w packages/genesys/src/sdk/go/main.go`, and `git diff --check`.
- Go helper: `go build -o /tmp/genesys-review-go-analyzer .` in `packages/genesys/src/sdk/go`.
- Java reader: `/tmp/genesys-java-tooling/jdk-21.0.13+9/Contents/Home/bin/javac -d /tmp/genesys-review-java-classes packages/genesys/sdk/java/Inspect.java`.
- Package: `npm pack --ignore-scripts --pack-destination /tmp/genesys-review-pack`; manifest inspection included all three compiled POSIX helper modules and existing native assets.
- Installed package: `npm install --prefix /tmp/genesys-review-install --ignore-scripts /tmp/genesys-review-pack/genesys-cli-0.0.0.tgz`.
- Native Go example: `/tmp/genesys-review-install/node_modules/.bin/gsys build /tmp/genesys-review-go-app` (copied existing example), exit 0. Output: `/tmp/genesys-notes/review-go-build.json` and `.log`.
- Native Java sample: `JAVA_HOME=/tmp/genesys-java-tooling/jdk-21.0.13+9/Contents/Home PATH=/tmp/genesys-java-tooling/apache-maven-3.9.11/bin:$PATH /tmp/genesys-review-install/node_modules/.bin/gsys build /tmp/genesys-review-java-app`, exit 0. Output: `/tmp/genesys-notes/review-java-build.json` and `.log`.
- Rust static inspection: `TMPDIR=/tmp/genesys-review-rust-temp /tmp/genesys-review-install/node_modules/.bin/gsys inspect /tmp/genesys-rust-native`; bundled Cargo analyzer compiled, authored application code was not executed. Output: `/tmp/genesys-notes/review-rust-inspect.json` and `.log`; manual `ls -la /tmp/genesys-review-rust-temp` showed no remaining analyzer directory.

No tests, test harnesses, assertion checks, Worker sessions, Temporal servers, or
live POSIX/Windows lifecycle checks were added or run. Native compilation does
not establish runtime readiness, shutdown correctness, or replay compatibility.

## Follow-up review corrections

Based on integration `14ed672`. Five additional gaps were confirmed and fixed:

1. PHP build plans and emission now share aggregate classification. Omitted
   collision aggregates are also omitted from native `php -l` inputs, so valid
   explicit independent scopes do not fail on a generated file that does not exist.
2. TypeScript symbol resolution obtains shorthand property **value** bindings
   before following const initializers. A validator alias now excludes its
   exported underlying function from automatic Workflow registration.
3. Go and Java collapse multiple native entrypoint candidates within one named
   Worker directory into one unresolved no-start plan with candidate diagnostics.
   Native package compilation remains required, and explicit executable overrides
   can resolve startup. Distinct Worker directories with the same selector name
   still produce fatal ambiguity diagnostics.
4. Docker copies retained builds and launch links as UID:GID `65532:65532`. The
   private version directory stays `0700`. Exact Linux bind-mount instructions use
   the host build owner's UID:GID. Rebuilding also exposed missing packaged-doc
   inputs in the image; Dockerfile/context now include `docs` and `GLOSSARY.md`.
   Tooling dependency installation in the image disables install scripts.
5. Database exclusions recognize native `-f value`, `-f=value`, and `-fvalue`
   aliases. The forwarded argument array remains unchanged.

Validation: CLI build, scoped oxlint/oxfmt, Go analyzer `go build`,
`git diff --check`, `docker compose -f examples/native-workers/compose.yaml config`,
and `docker compose -f examples/native-workers/compose.yaml build greeting` passed.
The first image build failed because packaged documentation was missing; the
corrected build passed and produced
`sha256:92b31eedc70877925dfc9b62a7c09b28da0b21756eaffe509aad5de53ef90175`.
Image build log: `/tmp/genesys-notes/review-image-build.log`; resolved configuration:
`/tmp/genesys-notes/review-compose-config.yaml`. No tests, new fixtures, assertions,
Worker sessions, Temporal servers, or image runtime sessions were run. Ticket 15
remains open pending a separate native coverage feasibility decision.

Nested directory correction: discovery now records the actual named Worker
directory. Go/Java grouping consumes that metadata instead of reconstructing a
key from discovery root and selector name. Thus `temporal/east/workers/shared`
and `temporal/west/workers/shared` remain separate conflicting selectors, while
multiple main candidates in the same actual directory retain override fallback.
CLI compilation, Go analyzer compilation, scoped formatting/lint and whitespace
checks passed; no fixtures or runtime checks were added.

## Bounded Go retirement coverage

Ticket 15 now has an actual positive path, reviewed independently by the spec and
standards reviewers. It requires Go SDK 1.51.0, POSIX host compilation with CGO
disabled, the checked single-Worker native closure, and unchanged direct launch.
No application interface or configuration was added. Unsupported constructs
produce a coverage diagnostic, not a native build error. All other SDKs,
Windows, arbitrary/overridden Go programs and versioned Workers retain unknown
eligibility and remain until explicit session shutdown.

The typed checker covers all linked application packages and callback bodies,
including generated registration. Native effective settings are read from
`go env`; custom flags, workspaces, vendor source and replacements are excluded.
A before/after source/module/context digest surrounds the exact native Go compile
without interleaved native builds. Native `go mod verify` checks source modules;
executable build information must carry SDK 1.51.0 checksum
`h1:RsEghFfg91qWgNaecRgPrms9TA7iXskSzSQO2BwhJRs=`. A binary digest binds direct
launch, and actual native child PID plus creation time binds live membership.
This assumes a trusted native toolchain/released libraries and no external
mutation of the private versioned snapshot or executable.

Six targeted proof findings were corrected and independently re-reviewed:

1. Force `GOPACKAGESDRIVER=off` for typed closure loading, matching ordinary Go
   compilation instead of accepting an unrelated custom package driver's graph.
2. Place typed source/context proof immediately around the exact native compile,
   before other native builds can alter Go inputs; bind the resulting binary.
3. Recheck session stopping state after asynchronous executable hashing and before
   creating the owned process.
4. After all awaited membership reads, use one final timestamp to recheck both
   complete expected task-type evidence sets, not only one successful poll.
5. Reject unexpected active/successful task types and preserve raw nonempty
   heartbeat deployment identity separately from generic poller mode. Empty
   unused native structures remain harmless; generic Java behavior is preserved.
6. Verify native module bytes and require the reviewed SDK checksum in build
   information, not merely the module name/version label.

Launch checks also reject inherited Node preloads and native loader overrides as
unknown without changing Worker environment semantics. Both generations must
have one matching fresh native unversioned instance with complete expected task
polling, matching SDK, namespace and queue, and exactly their bound live native
process. Coordinator revision/liveness gates remain. Missing evidence retains;
only the complete supported path requests native grace. Ownership loss or forced
anchor death still retains builds unless group completion is confirmed safely.

Checks: `pnpm --filter @genesys/cli build`; native helper
`go build -o /tmp/genesys-coverage-analyzer .` in `packages/genesys/src/sdk/go`;
scoped `gofmt`, `pnpm exec oxfmt`, `pnpm exec oxlint`, and `git diff --check`.
Positive native compilation:
`CGO_ENABLED=0 node packages/genesys/dist/cli.js build examples/native-workers`
with Node 26.13.1 and Go 1.27.4 on macOS arm64. Build ID:
`3374cec2-bf5d-4d07-a03d-16c1b4327007`; source/context SHA-256:
`38e4bce46965001f30d0c6ecebc7e174e9c7034f9751ed28b5b1f0fd968d3437`;
binary SHA-256:
`b0c2f2b7cae4142d54d0f39a1a48fcf760e21c7c96540fa2a60b0dcc5ead76df`.
The emitted proof records queue `greetings`, workflow/activity task types, SDK
1.51.0 and darwin/arm64. The initial missing-generated-import warning resolved
through registration emission and successful native compilation. Outputs:
`/tmp/genesys-notes/coverage-native-build.json` and `.log`.

No tests, new fixtures, harnesses, assertions, Workers, Temporal servers or live
retirement sessions were run. Static proof and compilation do not establish live
heartbeat/API availability, shutdown timing, replay or payload compatibility.
