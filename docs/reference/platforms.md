---
title: "Platform Support"
description: "Check Genesys host requirements, process ownership, and the scope of platform verification."
---

Genesys uses Node.js 24 or later to run `gsys`. Install the compiler, language runtime, and
dependencies your Worker application requires. Put the native Temporal CLI on `PATH` for
`gsys dev`. See [SDK Support](sdk/index.md) for native tools and language-specific limits.

## Package contents

The `@genesys/cli` package contains the CLI, JavaScript declarations, Go, Java, .NET, Python, Ruby,
and Rust analyzer sources, and the compiled POSIX process anchor. It also includes the Windows
process helper source, x64 and arm64 executables, and license notices. PHP analysis uses the
bundled php-parser dependency, and TypeScript analysis uses a pinned compiler dependency. Genesys
locates these resources relative to the installed package. Installation does not compile the
process helpers. See `native/README.md` in the installed package for Windows helper build provenance.

## Verified environments

| Host                                                      | Process ownership                                                  | Observed behavior and limits                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS 27.2.1 arm64                                        | POSIX process group with a retained Node anchor and system `ps`    | Installed-CLI Go inspection, build, and Workflow execution. Managed graceful and forced shutdown, failure reporting, and survival of an unrelated service. Direct Go deployment and a Compose-managed Temporal server.                                    |
| Debian 13 arm64 in Docker                                 | POSIX process group with a retained Node anchor and procps-ng `ps` | The same focused installed-Go and managed-shutdown cases passed in Linux Docker. A separate Linux arm64 deployment run used the same immutable build for direct container startup and Compose.                                                            |
| Windows 10 or Windows Server 2016 and later, x64 or arm64 | Bundled helper with a private console and Job Object               | Both helper binaries were cross-compiled, packaged, and inspected for the expected PE headers. Native Windows launch and shutdown are unverified. The Windows-specific cases were discovered and skipped on macOS because a Windows host was unavailable. |

The focused POSIX runs used Node.js 26.13.1, Go 1.27.4, Temporal Go SDK 1.51.0, and Temporal CLI
1.10.0 with Server 1.32.2. The installed CLI accepted a mixed-case project path containing spaces,
an apostrophe, and Unicode. Both hosts selected a native executable with the recorded mode and
target. These runs cover the listed Go and process cases. Other architectures, Linux distributions,
and SDK combinations require their own evidence.

POSIX hosts need `ps` with PID, process group, start time, and status fields. Windows needs an x64
or arm64 Node.js process, permission to execute the unsigned helper, and a host that permits its
Job Object assignment. Earlier Windows releases, other Windows architectures, and other operating
systems are outside this implementation. Each SDK has its own platform requirements. Temporal
Ruby SDK 1.11.0 does not support native MinGW Windows. Its Linux runtime is available under WSL.

## POSIX process ownership

On macOS and Linux, a Node anchor owns the process group for each managed server, Worker program,
and build job. The anchor remains the group leader after the native process exits until `ps`
confirms the group has no live members. Only the anchor signals its own occupied group ID. This
prevents the supervisor from signaling a recycled group ID. A descendant that deliberately leaves
the process group is outside that group's ownership.

The first interrupt or loss of parent IPC requests graceful shutdown. The anchor consumes its
own SIGINT, and the native children handle the same signal through their SDK or runtime. Genesys
sets no fixed graceful deadline. A second interrupt sends SIGKILL to the group, including the
anchor. Since the anchor cannot confirm completion after it dies, the supervisor reports lost
ownership confirmation and keeps associated builds. An unexpected anchor failure also withholds
further signals and cleanup. Inspect the remaining native processes if Genesys reports that loss.

## Windows process ownership

The Windows helper starts each managed server, Worker program, or build job in a private
console. Windows assigns the new process to an unnamed Job Object atomically during creation.
The launched process inherits only NUL stdin and its output pipes. The helper keeps the job and
control handles and clears the inherited Ctrl-C-ignore setting before launch.

The first interrupt or closure of the parent control pipe requests native Ctrl-C shutdown. The
helper stays after the leader exits and waits for the job to report zero active processes and for
its output to drain. A second interrupt terminates that job. Genesys targets the retained job
through its handle and sets no fixed graceful deadline. If the helper crashes, closing its job
handle forces its owned descendants to exit. A hard crash of the parent can request shutdown of
all helpers at once. During ordinary session shutdown, Workers stop before the managed server.
Genesys withholds build cleanup after a fatal helper or protocol failure. A recoverable
membership-query failure withholds readiness evidence while the helper retains ownership.

A program that creates another console or ignores Ctrl-C remains job-owned for waiting and force
termination. Its native handlers determine whether it shuts down gracefully. WMI, services, and
scheduled tasks can start processes outside ordinary descendant ownership. Restrictive host jobs
can reject launch. Genesys reports the Windows error before starting an unowned process.

## Arguments, tools, and paths

Worker and server launch commands use separate executable paths and argument arrays. On Windows,
the bridge resolves the executable to an absolute path and uses the CRT/libuv command-line
convention. It preserves empty arguments, spaces, quotes, Unicode, and trailing backslashes for
programs that follow that convention. Programs with custom parsers use their own argument rules.
The bridge passes a Unicode working directory and environment. Environment overrides replace
inherited names case-insensitively on Windows.

Use a native executable or pass a script as an argument to its interpreter. Genesys rejects
generic `.cmd` and `.bat` Worker overrides because they require shell evaluation. The bridge
resolves known npm, npx, pnpm, yarn, tsx, ts-node, and tsc shims to their installed JavaScript
entrypoints. It resolves known Ruby Bundler and Composer shims to their interpreter and adjacent
script. Missing or unrecognized layouts fail before launch.

For Maven and Gradle batch wrappers, native build execution and version queries use `cmd.exe`
with explicit quoting and delayed expansion disabled. Embedded quotes and newlines are rejected.
These authored scripts still follow native batch expansion rules. Package scripts run under
their package manager's rules.

Source manifests use slash-separated relative paths. Launch plans use native absolute working
directories inside the versioned build. Windows snapshots retarget directory links to junctions
inside the snapshot. File symlinks require Developer Mode or symbolic-link permission. Link
creation errors abort the build. Keep native outputs and virtual environments at their original
absolute paths. See [Versioned Builds](../guides/builds.md) for snapshot and publication rules.
