# Windows process helper

`owned-process-win32.c` implements Genesys process ownership on Windows 10 or
Windows Server 2016 and later. The package includes x64 and arm64 executables.
No compiler or install-time build is required. These binaries are unsigned.

The Node bridge starts this internal helper with `shell: false`, `detached: true`,
and three pipes. The helper allocates a private console, restores its pipe handles,
and launches one Worker with an explicit Unicode environment, executable, command
line, and working directory. `PROC_THREAD_ATTRIBUTE_JOB_LIST` assigns the process
to an unnamed job during creation. `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` limits
inheritance to the Worker's NUL stdin and two output pipes. The job and parent
control handles are not inherited. No breakaway flags are enabled.

The helper clears the inherited Ctrl-C-ignore flag before launch. Its own control
handler consumes console events. Graceful shutdown broadcasts Ctrl-C to the
private console and waits without a deadline. Force shutdown terminates the job.
Leader exit and job completion are distinct. The main thread polls control input,
leader exit, and job accounting every 20 ms; two threads drain Worker output.
Completion requires zero active job processes and drained output streams.

Control EOF before launch aborts startup when observed. EOF after launch requests
graceful shutdown. If EOF races with process creation, the next control poll sends
Ctrl-C. Parent record-pipe failure discards further records while control EOF still
requests grace. Helper failure or an operational error closes its sole job handle;
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` then terminates the owned tree. This prevents
leaks after a helper crash but cannot provide SDK grace after helper death.

## Internal protocol

The parent first sends three UTF-16LE strings: absolute executable, absolute
working directory, and a CRT-quoted command line. Each has a little-endian uint32
byte length, excludes the terminating NUL, and is nonempty with at most 65,532
bytes. Embedded NUL is rejected. There is no magic prefix. The command line
contains the executable as argv[0]. The bridge performs argument quoting; the
helper performs no shell parsing.

Subsequent input consists of single bytes: `G` requests grace, `F` forces the job,
and `L` requests membership. Every output record has a one-byte ASCII type, a
little-endian uint32 payload byte length, and payload bytes:

| Type | Payload                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| `P`  | ASCII decimal Worker leader PID, after successful creation and job assignment                               |
| `E`  | ASCII unsigned decimal leader exit code                                                                     |
| `D`  | Empty; whole job completed, after `E` and all Worker output                                                 |
| `X`  | ASCII failure stage, space, decimal Win32 error; helper exits nonzero without `D`                           |
| `Q`  | ASCII membership-query failure stage, space, decimal Win32 error; query fails while job ownership continues |
| `M`  | ASCII `pid unixMilliseconds\n` rows from the job's process list and process creation times                  |
| `O`  | Raw Worker stdout bytes                                                                                     |
| `R`  | Raw Worker stderr bytes                                                                                     |

`P` precedes normal records. `X` can also report failure before `P`. Output framing
is serialized across threads. The bridge must continuously drain helper stdout
and reserve helper stderr for diagnostics. An empty `M` means a successful empty
snapshot. List, access, timestamp, or ownership-query failures produce `Q`, never
an empty snapshot. The bridge rejects that membership request and retains the
Worker. A PID which has exited (`OpenProcess` returns `ERROR_INVALID_PARAMETER`)
or no longer belongs to the job is omitted. Each opened process handle is checked
with `IsProcessInJob` before its creation time is returned, so a reused PID outside
the job cannot become readiness evidence.

## Build provenance

The checked-in binaries were cross-compiled on macOS with the official
[llvm-mingw 20261104 UCRT release](https://github.com/mstorsjo/llvm-mingw/releases/tag/20261104):
LLVM 23.1.5, LLVM commit `392dfff97d29b59d77e5cac6d4b6ef2585fe7117`,
mingw-w64 commit `ee9bd87644156c41072a11ad957d1e11831a72df`.

The macOS universal archive SHA-256 is
`66cbd5178c4a71b0d473e68ede172f8eb7d15d023e67f39201d0a69e21f6bf3c`.
Download `llvm-mingw-20261104-ucrt-macos-universal.tar.xz` from the release,
verify that digest, and extract it. From the repository root:

```sh
sh packages/genesys/native/build.sh /absolute/path/to/llvm-mingw-20261104-ucrt-macos-universal
```

The script builds both architectures with optimization, warnings as errors,
stripped symbols, and a zero PE timestamp. Toolchain support code is statically
linked. Imports remain limited to Windows KERNEL32, USER32, and UCRT API-set DLLs.
The runtime license notices are included next to the binaries. The build does not
download dependencies, execute the helper, or invoke application code.

| Artifact                        | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `owned-process-win32-x64.exe`   | `f0f4e7cdaa367caa5c58cd16e7ed33c1964574c9b713c3a79c5a831e5d9c4160` |
| `owned-process-win32-arm64.exe` | `ace2cfc076886623c34e427fde5b7a0f09dfde83cc74f02a10353de89b35a2d8` |

Both release builds passed `-Wall -Wextra -Werror`. Clang static analysis of the
x64 source reported no diagnostics. `llvm-readobj --file-headers --coff-imports`
confirmed each target architecture, zero timestamp, and system-only imports.
These are build and static-inspection results. No Windows runtime execution,
SDK signal check, or tests were performed. Cross-host byte equality is unverified.

## Platform limits and API references

Console Workers must handle native Ctrl-C to shut down gracefully. A descendant
that detaches from the console remains job-owned but cannot receive that console's
Ctrl-C. Existing restrictive host jobs can reject launch; this fails before an
unowned Worker can run. WMI, service, or scheduler launches are outside ordinary
CreateProcess ancestry. Processes that transfer pipe handles to unrelated external
processes can prevent output EOF. Arbitrary `.cmd` and `.bat` files cannot use this
direct executable contract; the bridge must resolve known native entrypoints or
reject them.

- [Job objects and descendant ownership](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Process attributes, including JOB_LIST and HANDLE_LIST](https://learn.microsoft.com/nl-nl/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
- [Console handlers and inherited Ctrl-C behavior](https://learn.microsoft.com/en-us/windows/console/setconsolectrlhandler)
- [Job process list](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list)
- [Process handle ownership checks](https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob)
- [Process creation times](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
