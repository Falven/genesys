# 10: Publish complete versioned builds

**What to build:** Isolated native builds package Worker code and matching registration without replacing the last successful output on failure.

**Blocked by:** 02: Build native Go Workers.

**Status:** ready-for-agent

**State:** resolved

- [x] Publish only after generation and native build success. Preserve authored files.
- [x] Record all generated output locations and build inputs. Keep build IDs separate from Temporal deployment identities.
- [x] Keep each build independently usable by its native Worker programs. Do not depend on mutable application source.
- [x] Retain builds required by active Workers. Remove only owned outputs when no Worker requires them.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

Implemented isolated versioned builds in `packages/genesys/src/build.ts`, extracted
from the shared SDK pipeline. CLI build publication now uses that subsystem;
inspection remains a static operation.

Each candidate snapshots authored files and installed dependencies at its final
`.gsys/compile/builds/<id>/project` path, reanalyzes there, emits registration, and
runs native compilation. Existing generated source headers, `.git`, `.gsys`, and
Python environments are excluded from snapshots. Internal links are retargeted;
external authored links and native output links back to mutable source are rejected.
Absolute Python environments are never moved after construction. Generated import
locations outside `.gsys`, native binary outputs, all input hashes, generator file
hashes, tool versions, platform, environment fingerprint, and native launch plans
are recorded. Build IDs never set Temporal deployment identity.

Publication uses one atomic current-manifest rename after immutable metadata and
manifest files are complete. `metadata.json` is a convenience reference through
that manifest, not a separate build selector. Unpublished candidates are removed
in `finally`; earlier successful outputs are retained. `cleanupBuild` can remove
only one build created by its process, refuses current/required builds, and requires
the caller's complete retained-build set. Native readiness/retirement evidence is
kept separate. Failure and cleanup safety paths were reviewed in code only.

Validation: `pnpm --filter @genesys/cli build` passed using Node 26.13.1; scoped
`oxfmt --check` and `git diff --check` passed. Ordinary native compilation of the
existing `/tmp/genesys-go-native-build` project succeeded with Go 1.27.4 and
Temporal Go SDK 1.51.0. The final published snapshot was
`.gsys/compile/builds/4c7f6189-9659-4ad5-a289-f8b57acc4f20/project`; its manifest
records package-local registration, aggregate registration, and the Worker binary.
A pre-generation unresolved generated-import warning remained visible; native
compilation succeeded after emission. No Worker was started. No tests, assertion
harnesses, or failure fixtures were added or run.

Limits: native build scripts are not sandboxed, and hard-coded absolute application
paths are not rewritten. Native local dependencies must belong to the selected
workspace. System toolchains remain environment requirements. Unpinned network
dependencies can change native outputs; hashes record actual snapshot inputs but
do not claim byte-identical native binaries. Python path handling and non-Go native
builds were not runtime-validated in this ticket. See `docs/builds/versioned-builds.md`.

Final review correction: each candidate version parent is private (0700) from creation, before source copying. Development snapshots exclude explicitly managed SQLite data and sidecars. Installed-package native Go and Java builds passed. See [final review evidence](../review.md).
