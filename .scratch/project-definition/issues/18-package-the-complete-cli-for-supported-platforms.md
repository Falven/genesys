# 18: Package the complete CLI for supported platforms

**What to build:** An npm-distributed CLI supports macOS, Linux, and Windows with documented SDK features and limits.

**Blocked by:** 12: Select Workers and forward native arguments, 13: Reuse an existing supervisor, 15: Retire eligible Worker versions, 16: Run mixed-language projects, 17: Run the same builds through Compose and local processes.

**Status:** ready-for-agent

**State:** resolved

- [x] Package executable code and required SDK tooling assets. Ensure installed commands resolve their own resources.
- [x] Handle native paths, argument boundaries, executable invocation, and process ownership on each supported OS.
- [x] Document commands, conventions, generated artifacts, native assembly, and development lifecycle.
- [x] Record exact SDK versions and individual capabilities. Do not claim unverified SDK or platform support.
- [x] Use available native builds, type checks, formatting, and review. Record verification gaps honestly.
- [x] Add no tests, test harnesses, or assertion-based self-checks. The user explicitly excluded tests.

## Comments

2026-11-16: Completed npm resources, Windows ownership, native command handling and
release documentation. The package ships all required analyzer sources and compiled
Windows x64/arm64 helpers; resources resolve from the installed module. The helper
uses a private console, atomic JOB_LIST assignment, restricted inherited handles,
explicit Unicode launch data, native Ctrl-C, Job Object force termination, process
birth-time membership and distinct leader/job completion. Control EOF requests
grace; helper failure uses kill-on-close and reports unconfirmed completion. A
recoverable membership failure withholds observation without killing the Worker.
The Node bridge preserves output streams and native argv, resolves known interpreter
shims, and rejects generic batch Worker commands. Native build wrappers retain their
authored cmd.exe semantics. Snapshot directory links use Windows junctions; file
symlinks still need the native Windows privilege. Generator provenance includes
native helper assets. Shutdown errors retain build cleanup protection and propagate
through the session result.

The installed README and full documentation cover commands, conventions, native
assembly, generated/versioned outputs, replacement, retirement, platform boundaries
and the eight-SDK matrix. Official latest release APIs were checked on 2026-11-16:
Go 1.51.0, Java 1.40.0, .NET 1.22.0, PHP 2.20, Python 1.36.1, Ruby 1.11.0, Rust 1.2.0
and TypeScript 1.25.0. PHP advanced from the ticket 05 evidence at 2.19. Its official
API diff leaves the registration interface/declaration readers unchanged; updated
diagnostics and documentation retain the distinction between SDK features and
static tooling. Ruby's native MinGW Windows limit is documented separately.

Checks completed: CLI TypeScript typecheck and build with Node 26.13.1; scoped
oxfmt; Git whitespace checks; npm pack and tarball content inspection; tarball
installation with scripts disabled; macOS arm64 native Go example builds from both
the workspace CLI and the installed gsys executable. The installed build published
successfully and resolved packaged Go helper resources and native-helper provenance.
Both Go builds emitted the existing pre-generation missing-registration import
warning, then generated registration and compiled successfully. The archive contains
92 files, including both PE binaries and all analyzers, without native build caches.

Windows helper validation: llvm-mingw 20261104 / LLVM 23.1.5 release cross-builds for
x64 and arm64 with -Wall -Wextra -Werror; Clang static analysis without diagnostics;
PE architecture, zero timestamp and system-only DLL import inspection. Artifact
SHA-256 hashes were checked against native/README.md. The source/build recipe and
LLVM/MinGW runtime notices are included. PHP release refresh used the existing
isolated PHP 8.5.12/Composer 2.11.2 toolchain: dependency installation at temporal/sdk
v2.20 and syntax compilation of the existing generated registration and Workflow
source passed.

Limits: no tests, harnesses, assertions, live Workers, Temporal sessions or Windows
executions were added or run. Cross-builds do not establish Windows SDK handlers,
all-platform ABI compatibility, replay/payload behavior or older SDK support.
Unsigned native helper execution depends on host policy. Helper crashes cannot
honor SDK grace; parent hard crashes cannot guarantee Worker-before-server EOF
ordering. Detailed constraints and exact SDK evidence are in docs/platforms.md,
docs/sdk-support.md, each SDK page and packages/genesys/native/README.md.

Final review correction: npm packaging includes compiled POSIX anchor, group reader and IPC bridge. The tarball installed with scripts disabled and built the existing native Go example and current Java instance-only aggregate. POSIX force termination retains builds when anchor completion is unknown. Automatic retirement is unavailable; ticket 15 remains open. No live platform/session checks were run. See [final review evidence](../review.md).

Later bounded coverage completion supersedes the blanket retirement limit above:
Go SDK 1.51.0 has the reviewed POSIX/CGO-disabled/direct/unversioned path described
in [ticket 15](15-retire-eligible-worker-versions.md). The existing package source
patterns include the new Go coverage helper. Other program forms and versioned
Workers remain retained. No runtime checks were added.
