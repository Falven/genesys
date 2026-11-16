#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static HANDLE control_pipe;
static HANDLE record_pipe;
static CRITICAL_SECTION record_lock;
static BOOL records_closed;

static BOOL write_bytes(const void *data, DWORD length) {
    const BYTE *cursor = data;
    while (length) {
        DWORD written;
        if (!WriteFile(record_pipe, cursor, length, &written, NULL) || !written)
            return FALSE;
        cursor += written;
        length -= written;
    }
    return TRUE;
}

static void record(BYTE type, const void *data, DWORD length) {
    BYTE header[] = {type, (BYTE)length, (BYTE)(length >> 8),
                     (BYTE)(length >> 16), (BYTE)(length >> 24)};
    EnterCriticalSection(&record_lock);
    // A dead parent must still get graceful shutdown through control-pipe EOF.
    if (!records_closed &&
        (!write_bytes(header, sizeof(header)) || !write_bytes(data, length)))
        records_closed = TRUE;
    LeaveCriticalSection(&record_lock);
}

static void error_record(BYTE type, const char *stage, DWORD error) {
    char message[160];
    int length = snprintf(message, sizeof(message), "%s %lu", stage,
                          (unsigned long)error);
    record(type, message, (DWORD)length);
}

static void fail(const char *stage, DWORD error) {
    error_record('X', stage, error);
    // Closing the sole job handle on process exit kills only the owned tree.
    ExitProcess(1);
}

static void require(BOOL result, const char *stage) {
    if (!result) fail(stage, GetLastError());
}

static void *allocate(SIZE_T size) {
    void *result = calloc(1, size);
    if (!result) fail("allocate", ERROR_NOT_ENOUGH_MEMORY);
    return result;
}

static void read_bytes(void *data, DWORD length) {
    BYTE *cursor = data;
    while (length) {
        DWORD count;
        require(ReadFile(control_pipe, cursor, length, &count, NULL), "request-read");
        if (!count) fail("request-eof", ERROR_BROKEN_PIPE);
        cursor += count;
        length -= count;
    }
}

static WCHAR *read_string(void) {
    BYTE size[4];
    read_bytes(size, sizeof(size));
    DWORD length = (DWORD)size[0] | ((DWORD)size[1] << 8) |
                   ((DWORD)size[2] << 16) | ((DWORD)size[3] << 24);
    if (!length || (length & 1) || length > 65532)
        fail("request-length", ERROR_INVALID_DATA);
    WCHAR *value = allocate(length + sizeof(WCHAR));
    read_bytes(value, length);
    for (DWORD i = 0; i < length / sizeof(WCHAR); ++i)
        if (!value[i]) fail("request-nul", ERROR_INVALID_DATA);
    return value;
}

static BOOL absolute_path(const WCHAR *path) {
    size_t length = wcslen(path);
    return (length >= 3 &&
            ((path[0] >= L'A' && path[0] <= L'Z') ||
             (path[0] >= L'a' && path[0] <= L'z')) &&
            path[1] == L':' && (path[2] == L'\\' || path[2] == L'/')) ||
           (length >= 3 && path[0] == L'\\' && path[1] == L'\\');
}

static BOOL WINAPI console_event(DWORD event) {
    (void)event;
    return TRUE;
}

typedef struct {
    HANDLE pipe;
    BYTE type;
} Output;

static DWORD WINAPI pump_output(void *argument) {
    Output *output = argument;
    BYTE buffer[16384];
    for (;;) {
        DWORD length;
        if (!ReadFile(output->pipe, buffer, sizeof(buffer), &length, NULL)) {
            DWORD error = GetLastError();
            if (error == ERROR_BROKEN_PIPE) break;
            fail(output->type == 'O' ? "stdout-read" : "stderr-read", error);
        }
        if (!length) break;
        record(output->type, buffer, length);
    }
    CloseHandle(output->pipe);
    return 0;
}

static void number_record(BYTE type, DWORD number) {
    char message[32];
    int length = snprintf(message, sizeof(message), "%lu", (unsigned long)number);
    record(type, message, (DWORD)length);
}

static void membership(HANDLE job) {
    DWORD capacity = 64;
    JOBOBJECT_BASIC_PROCESS_ID_LIST *list;
    for (;;) {
        DWORD bytes = (DWORD)(sizeof(*list) + (capacity - 1) * sizeof(ULONG_PTR));
        list = allocate(bytes);
        BOOL queried = QueryInformationJobObject(job, JobObjectBasicProcessIdList,
                                                 list, bytes, NULL);
        DWORD error = queried ? ERROR_SUCCESS : GetLastError();
        if (queried && list->NumberOfProcessIdsInList == list->NumberOfAssignedProcesses)
            break;
        free(list);
        if (!queried && error != ERROR_MORE_DATA) {
            error_record('Q', "membership-list", error);
            return;
        }
        if (capacity > 1048576) {
            error_record('Q', "membership-size", ERROR_NOT_ENOUGH_MEMORY);
            return;
        }
        capacity *= 2;
    }
    // One whole response prevents concurrent output from splitting the snapshot.
    char *message = allocate((SIZE_T)list->NumberOfProcessIdsInList * 48 + 1);
    DWORD length = 0;
    const char *failure = NULL;
    DWORD error = ERROR_SUCCESS;
    for (DWORD i = 0; i < list->NumberOfProcessIdsInList; ++i) {
        DWORD pid = (DWORD)list->ProcessIdList[i];
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!process) {
            error = GetLastError();
            if (error == ERROR_INVALID_PARAMETER) continue;
            failure = "membership-open";
            break;
        }
        BOOL belongs;
        if (!IsProcessInJob(process, job, &belongs)) {
            error = GetLastError();
            failure = "membership-owner";
            CloseHandle(process);
            break;
        }
        // The listed process may exit and its PID may be reused before OpenProcess.
        if (!belongs) {
            CloseHandle(process);
            continue;
        }
        FILETIME created, exited, kernel, user;
        if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) {
            error = GetLastError();
            failure = "membership-time";
            CloseHandle(process);
            break;
        }
        ULARGE_INTEGER ticks;
        ticks.LowPart = created.dwLowDateTime;
        ticks.HighPart = created.dwHighDateTime;
        unsigned long long milliseconds = ticks.QuadPart / 10000 - 11644473600000ULL;
        length += (DWORD)snprintf(message + length, 48, "%lu %llu\n",
                                  (unsigned long)pid, milliseconds);
        CloseHandle(process);
    }
    if (failure) error_record('Q', failure, error);
    else record('M', message, length);
    free(message);
    free(list);
}

static void graceful(void) {
    // Group zero broadcasts only to this helper's private console.
    require(GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0), "console-interrupt");
}

static void commands(HANDLE job, BOOL *control_closed) {
    if (*control_closed) return;
    DWORD available;
    if (!PeekNamedPipe(control_pipe, NULL, 0, NULL, &available, NULL)) {
        DWORD error = GetLastError();
        if (error != ERROR_BROKEN_PIPE) fail("control-peek", error);
        *control_closed = TRUE;
        graceful();
        return;
    }
    // A bounded batch leaves time to observe leader exit and job completion.
    if (available > 64) available = 64;
    for (DWORD i = 0; i < available; ++i) {
        BYTE command;
        read_bytes(&command, 1);
        switch (command) {
            case 'G': graceful(); break;
            case 'F': require(TerminateJobObject(job, 1), "job-terminate"); break;
            case 'L': membership(job); break;
            default: fail("control-command", ERROR_INVALID_DATA);
        }
    }
}

int main(void) {
    control_pipe = GetStdHandle(STD_INPUT_HANDLE);
    record_pipe = GetStdHandle(STD_OUTPUT_HANDLE);
    HANDLE diagnostics = GetStdHandle(STD_ERROR_HANDLE);
    InitializeCriticalSection(&record_lock);
    require(SetHandleInformation(control_pipe, HANDLE_FLAG_INHERIT, 0), "control-private");
    require(SetHandleInformation(record_pipe, HANDLE_FLAG_INHERIT, 0), "records-private");
    require(SetHandleInformation(diagnostics, HANDLE_FLAG_INHERIT, 0), "diagnostics-private");

    WCHAR *executable = read_string();
    WCHAR *directory = read_string();
    WCHAR *command_line = read_string();
    if (!absolute_path(executable) || !absolute_path(directory))
        fail("request-absolute-path", ERROR_INVALID_NAME);

    require(AllocConsole(), "console-allocate");
    require(SetStdHandle(STD_INPUT_HANDLE, control_pipe), "console-restore-input");
    require(SetStdHandle(STD_OUTPUT_HANDLE, record_pipe), "console-restore-output");
    require(SetStdHandle(STD_ERROR_HANDLE, diagnostics), "console-restore-error");
    HWND console = GetConsoleWindow();
    if (console) ShowWindow(console, SW_HIDE);
    // The NULL handler flag is inherited; the non-NULL handler is not.
    require(SetConsoleCtrlHandler(NULL, FALSE), "console-reset-ignore");
    require(SetConsoleCtrlHandler(console_event, TRUE), "console-handler");

    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) fail("job-create", GetLastError());
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    require(SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                                    &limits, sizeof(limits)), "job-limits");

    SECURITY_ATTRIBUTES inheritable = {sizeof(inheritable), NULL, TRUE};
    Output output = {NULL, 'O'}, errors = {NULL, 'R'};
    HANDLE stdout_write, stderr_write;
    require(CreatePipe(&output.pipe, &stdout_write, &inheritable, 0), "stdout-pipe");
    require(CreatePipe(&errors.pipe, &stderr_write, &inheritable, 0), "stderr-pipe");
    require(SetHandleInformation(output.pipe, HANDLE_FLAG_INHERIT, 0), "stdout-private");
    require(SetHandleInformation(errors.pipe, HANDLE_FLAG_INHERIT, 0), "stderr-private");
    HANDLE input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                               &inheritable, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (input == INVALID_HANDLE_VALUE) fail("stdin-null", GetLastError());

    SIZE_T attribute_size = 0;
    InitializeProcThreadAttributeList(NULL, 2, 0, &attribute_size);
    if (!attribute_size) fail("attributes-size", GetLastError());
    STARTUPINFOEXW startup = {0};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input;
    startup.StartupInfo.hStdOutput = stdout_write;
    startup.StartupInfo.hStdError = stderr_write;
    startup.lpAttributeList = allocate(attribute_size);
    require(InitializeProcThreadAttributeList(startup.lpAttributeList, 2, 0,
                                              &attribute_size), "attributes-initialize");
    HANDLE inherited[] = {input, stdout_write, stderr_write};
    require(UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                      PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                      inherited, sizeof(inherited), NULL, NULL),
            "attributes-handles");
    require(UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                      PROC_THREAD_ATTRIBUTE_JOB_LIST,
                                      &job, sizeof(job), NULL, NULL), "attributes-job");
    WCHAR *environment = GetEnvironmentStringsW();
    if (!environment) fail("environment", GetLastError());
    DWORD available;
    require(PeekNamedPipe(control_pipe, NULL, 0, NULL, &available, NULL), "startup-control");
    PROCESS_INFORMATION process = {0};
    require(CreateProcessW(executable, command_line, NULL, NULL, TRUE,
                           EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                           environment, directory, &startup.StartupInfo, &process),
            "process-create");
    FreeEnvironmentStringsW(environment);
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    free(startup.lpAttributeList);
    free(executable);
    free(directory);
    free(command_line);
    CloseHandle(input);
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);
    CloseHandle(process.hThread);
    number_record('P', process.dwProcessId);
    HANDLE output_thread = CreateThread(NULL, 0, pump_output, &output, 0, NULL);
    if (!output_thread) fail("stdout-thread", GetLastError());
    HANDLE error_thread = CreateThread(NULL, 0, pump_output, &errors, 0, NULL);
    if (!error_thread) fail("stderr-thread", GetLastError());

    BOOL leader_exited = FALSE, control_closed = FALSE;
    for (;;) {
        commands(job, &control_closed);
        if (!leader_exited) {
            DWORD status = WaitForSingleObject(process.hProcess, 0);
            if (status == WAIT_FAILED) fail("leader-wait", GetLastError());
            if (status == WAIT_OBJECT_0) {
                DWORD exit_code;
                require(GetExitCodeProcess(process.hProcess, &exit_code), "leader-exit");
                number_record('E', exit_code);
                leader_exited = TRUE;
            }
        }
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
        require(QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                                          &accounting, sizeof(accounting), NULL),
                "job-accounting");
        if (!accounting.ActiveProcesses && leader_exited) break;
        Sleep(20);
    }
    // All job writers are gone; drain bytes still in the pipes before completion.
    if (WaitForSingleObject(output_thread, INFINITE) != WAIT_OBJECT_0)
        fail("stdout-wait", GetLastError());
    if (WaitForSingleObject(error_thread, INFINITE) != WAIT_OBJECT_0)
        fail("stderr-wait", GetLastError());
    CloseHandle(output_thread);
    CloseHandle(error_thread);
    CloseHandle(process.hProcess);
    CloseHandle(job);
    record('D', NULL, 0);
    return 0;
}
