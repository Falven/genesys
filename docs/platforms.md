# Platforms and distribution

Genesys ships as the npm package `@genesys/cli`, with the `gsys` command and a
Node.js 24+ requirement. Node runs tooling; applications still use their native
SDK language, compiler, dependencies and Worker program. `gsys dev` also needs
the native Temporal CLI on PATH. No npm install hook compiles native helpers.

The package includes compiled JavaScript and declarations, native Go/Java/.NET/
Python/Ruby/Rust analyzer sources, the compiled POSIX group anchor, the Windows process helper source and x64/arm64
binaries, license notices, and this documentation under `dist/docs`. PHP analysis
uses the packaged php-parser dependency; TypeScript analysis uses the pinned
compiler dependency. Resources resolve relative to the installed module, not the
user's current directory. Native helper build provenance is in
`native/README.md` in the installed package.

| Host                              | Process ownership                                                                                          | Evidence and limits                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                             | Retained group anchor; native `ps` membership; anchor sends its own group SIGINT or SIGKILL                | CLI build/typecheck and several SDK native builds on arm64. No live managed-session or shutdown checks                                          |
| Linux                             | Retained group anchor; native `ps` membership; anchor sends its own group SIGINT or SIGKILL                | Linux arm64 native example build and Compose configuration/image build. No live managed-session or shutdown checks                              |
| Windows 10 / Server 2016 or later | Bundled x64/arm64 helper; private console and atomic Job Object assignment; Ctrl-C then TerminateJobObject | Both release binaries cross-compiled and inspected. Windows execution, native SDK shutdown handlers, and host security policy remain unverified |

POSIX hosts need `ps` with PID, group, start-time and status fields. A descendant
that deliberately leaves its process group is outside that group's ownership.
Windows support requires x64 or arm64 Node and permission to execute the bundled
unsigned helper. Earlier Windows releases, other Windows architectures and other
operating systems are outside this implementation. SDK platform availability is
separate: in particular, Ruby SDK 1.11.0 supports macOS/Linux but does not support
MinGW Windows. Use its documented Linux environment under WSL.

## Ownership and shutdown

On macOS/Linux, each managed server, Worker program, and build job has a bundled
Node group anchor. The anchor remains the group leader after the native program
exits, until `ps` confirms that no live group members remain. Shutdown requests
use IPC. Only the anchor signals its own occupied group ID, so a recycled group
ID can never be signaled by the supervisor. The anchor consumes its own SIGINT;
the native children receive the real group signal and keep native shutdown rules.
There is no fixed graceful deadline. Parent IPC loss requests graceful shutdown.
A second interrupt requests group SIGKILL, which also kills the anchor. That
cannot confirm group completion, so the session reports ownership loss and
retains the associated builds. An unexpected anchor failure also withholds all
cleanup and further signaling; inspect the remaining native processes manually.
No live POSIX helper, shutdown, or forced-termination session has been run.

On Windows, each managed server, Worker program or build job receives one private
console and one unnamed Job Object. The Worker is assigned during CreateProcessW
through JOB_LIST; it never runs outside ownership first. Only its NUL stdin and
output pipes are inherited. The job and control pipe handles stay with the helper.
The helper removes the inherited Ctrl-C-ignore setting; its own console handler
consumes events without changing the Worker's native handlers.

Graceful shutdown sends Ctrl-C to that private console. The helper remains alive
after the leader exits and waits until native accounting reports no active job
processes and output is drained. There is no Genesys shutdown deadline. A second
interrupt terminates that exact retained job. Genesys does not kill by executable
name, port owner or reconstructed PID ancestry. Recoverable process-membership
query errors withhold readiness evidence while retaining the job.

Normal session shutdown waits for Workers before managed Temporal. Parent control
EOF requests grace. A helper crash closes a kill-on-close job and force-terminates
its owned descendants; it cannot provide SDK grace. A parent hard crash can close
all helpers' control pipes at once, so Worker-before-server ordering cannot be
guaranteed in that failure case. Fatal helper/protocol failure is an error, not
confirmed tree completion, and build cleanup remains withheld. Error cleanup
requests server shutdown and reports the ownership failure.

A Worker that creates another console or ignores Ctrl-C stays job-owned for
waiting and force termination, but cannot be made to honor SDK grace by Genesys.
WMI, services and scheduled tasks do not use ordinary descendant creation and are
outside this ownership contract. Restrictive host jobs can reject atomic launch;
Genesys reports the Win32 failure instead of running an unowned Worker.

## Arguments, tools and paths

Worker and server commands use separate executable paths and argument arrays.
The Windows bridge resolves the executable to an absolute path and converts each
argument to the CRT/libuv command-line convention, preserving empty arguments,
spaces, quotes, Unicode and trailing backslashes. It passes an explicit Unicode
environment and working directory. Windows programs with their own command-line
parser must interpret the native command line according to their runtime contract.
Environment overrides replace inherited names case-insensitively on Windows.

Windows `.cmd`/`.bat` files require cmd.exe and cannot provide arbitrary unchanged
arguments without shell interpretation. Genesys resolves known npm/npx, pnpm,
yarn, tsx, ts-node and tsc shims through their installed package's declared JavaScript
entrypoint and Node. Ruby Bundler and Composer shims resolve to their native
interpreter and adjacent script. A missing or unrecognized layout fails clearly.
Generic batch Worker overrides are rejected before Worker creation. Pass a native
executable or interpreter with script arguments instead. Server and Worker
arguments are never implicitly evaluated by a shell.

Native build tools are a different boundary: Maven/Gradle batch wrappers are
authored build scripts. Build execution and version queries use cmd.exe for those
scripts, with explicit quoting and delayed expansion disabled. Native batch
expansion rules still apply; embedded quotes/newlines are rejected. Application
package scripts can execute authored code under their package manager's rules.
This does not change the direct Worker/server argument contract.

Source manifests use slash-separated relative paths; launch plans use native
absolute working directories inside the corresponding versioned build. Snapshots
copy files and retarget internal links. Windows directory links become junctions
to the corresponding snapshot directory without requiring symbolic-link privilege.
File symlinks still require Windows Developer Mode or symbolic-link permission;
creation errors abort the build. External links and links into excluded source
are rejected. Native outputs and virtual environments retain their original
versioned location; moving a build is not supported.

## Release checks

The Windows helpers use llvm-mingw 20261104 / LLVM 23.1.5 with static runtime
support, warnings as errors and zero PE timestamps. File-header inspection
confirmed x64 and arm64 targets; imports are Windows system/UCRT DLLs only. Clang
static analysis reported no diagnostics. Native Windows binaries were not run.

The CLI passed its TypeScript build/typecheck, scoped formatting and whitespace
checks. npm pack contents were inspected for the executable, both native binaries,
analyzer sources and installed documentation. A tarball installation with scripts disabled also built the native Go example
through its installed `gsys` executable. Native macOS compilation and the
PHP v2.20 dependency/syntax refresh are build evidence only. The
[SDK matrix](sdk-support.md) records the exact per-language limits. No tests or
runtime assertions were added or run.
