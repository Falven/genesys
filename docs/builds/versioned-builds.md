# Versioned native builds

`gsys build [project-directory]` copies the project, analyzes that copy, generates
registration, and runs the native build commands there. The authored files are
not generation destinations. Native build scripts can execute application code;
`gsys inspect` does not run those scripts or start Workers.

The stable workspace is `.gsys/compile/builds/<id>/project`. It is created at its
final path before any native command runs. Python virtual environments and native
console scripts can contain absolute paths, so a completed workspace is never
renamed. Each Worker command has an absolute working directory in that workspace.
Build IDs identify Genesys outputs only. They do not set Temporal deployment names,
Build IDs, readiness, or routing.

The snapshot copies regular files and preserves internal symbolic links with
snapshot-relative targets. It rejects links to source outside the project root.
Use the native workspace root that includes local dependencies. Dependencies such
as `node_modules` and `vendor` are copied; native package tools retain ownership of
resolution and installation. `.git`, `.gsys`, Python environments, and Python bytecode
caches are excluded. Existing source with an explicit Genesys generated header is
excluded so removed definitions cannot leave stale generated registration behind.
Python environments are rebuilt through their native build plans. Native output
links back to authored files or an earlier build are rejected.

Native toolchains and system libraries remain environment requirements, not bundled
application source. Authored native package settings must resolve local source and
local dependencies within the selected project root. Arbitrary build scripts and
hard-coded absolute application paths are not sandboxed or rewritten. Supply a
complete native workspace instead of depending on mutable source outside it.

## Publication and inspection

A successful build writes these records:

- `.gsys/compile/builds/<id>/manifest.json`: immutable build manifest, source
  discovery, native Worker commands and readiness limits, and output locations.
- `.gsys/compile/builds/<id>/metadata.json`: input file hashes, sizes and modes;
  symlink targets; generated registration hashes; native command and tool-version
  records; generator file hashes; platform and architecture; and diagnostics.
- `.gsys/compile/manifest.json`: the authoritative current manifest, replaced with
  one atomic rename after generation, native compilation, and metadata succeed.
- `.gsys/compile/metadata.json`: a stable instruction to read the authoritative
  manifest's `metadataPath`. It is a convenience reference, not a second selector.

Read the current manifest once, then follow its immutable paths. There is no
multi-file atomicity claim. Candidate failure leaves the previous manifest selected
and removes only the failed candidate directory. Builds are never launched during
publication. Source and native-output records use paths relative to the snapshot;
manifest and Worker command paths are absolute. Outputs include native imports
outside `.gsys`, generated registration, native binaries, dependency installation
outputs, and changed files. Metadata also records files removed by native tooling.

Every invocation takes a new snapshot and rebuilds. There is no dependency cache
invalidation heuristic: changed source, manifests, lockfiles, installed dependency
files, or build settings become new recorded inputs. Lockfiles and native package
versions remain inspectable within the snapshot. Environment values are hashed as
one fingerprint rather than copied into metadata. This detects a changed build
environment without publishing secrets; it does not reconstruct that environment.
Unpinned network dependencies and native tool behavior can still change outputs.
The build record does not claim byte-identical native binaries or runtime validation.

## Programmatic use and retention

`buildProject(path)` returns `{ state: "published", project, build }` after success
or `{ state: "failed", project }` for analysis/generation errors. Filesystem and
native-command failures throw after candidate cleanup. `build` includes `id`,
`root`, `projectRoot`, `workers`, `artifacts`, `inputs`, `tools`, `manifestPath`, and
`metadataPath`. Launch Workers from `build.workers`, using `build.root`, rather than
reanalyzing the authored project or using its mutable source. Direct processes and
Compose can consume those same snapshot commands and files. Absolute native paths
must retain their location inside the execution environment.

Publication retains earlier successful versions. `cleanupBuild(build, requiredIds)`
removes one build created by the current process only when it is absent from the
complete required-build set and is not the current published build. It does not
scan directories or remove another process's builds. The supervisor must include
all active and retained Worker versions, including versions still awaiting native
retirement evidence. Build cleanup does not establish that evidence. Keep the build
until its last required Worker has exited. External consumers must also be included
in retention decisions. Incomplete retention knowledge is a reason to keep a build.

No tests or application runs were used to validate this subsystem. Verification
used TypeScript compilation, formatting, an ordinary Go native build, and code
review of publication and retention paths. Python absolute-path handling is based
on the native environment contract; it was not runtime-validated here.

Each candidate is created beneath a private `0700` version directory before any
source copy. Nested native source modes are retained inside that boundary.
Development snapshots exclude explicitly forwarded Temporal database paths and
SQLite sidecars; ordinary build commands do not infer runtime data locations.
