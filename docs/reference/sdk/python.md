---
title: "Python SDK Reference"
description: "Discover Python definitions, consume generated registration, and build a native Worker environment."
---

Genesys uses a packaged Python 3.11 or later helper with standard-library parsers in isolated
mode (`python3 -I`, or `python -I` on Windows). Discovery and registration generation parse
source and native package metadata without importing the SDK, application modules, or build
backends.

## Supported source forms

| Definition            | Supported Python forms                                           |
| --------------------- | ---------------------------------------------------------------- |
| Workflow              | Classes decorated with `@temporalio.workflow.defn`               |
| Activity              | Functions and methods decorated with `@temporalio.activity.defn` |
| Nexus service handler | Classes decorated with `@nexusrpc.handler.service_handler`       |

An entry can hold several definitions. Genesys resolves imports, import aliases, explicit
re-exports, relative imports, and module-level literal constants. `dynamic=True` declares a
native catch-all. A computed name remains unresolved. Workflow handlers stay on the authored
class. Nexus service names resolve through a local `@nexusrpc.service` contract or a literal
`service_handler(name=...)`. Operation handlers and factory methods stay on the authored
service instance.

## Register definitions

Each discovery root gets Python modules for its Workflows, Activities, and Nexus handlers.
Each module's `registrations(...)` returns a tuple for the corresponding native Worker
keyword, `workflows`, `activities`, or `nexus_service_handlers`. Supply instances from your
own constructors, factories, or dependency injection for bound Activity methods and Nexus
handlers. Workflow classes and free functions require no instance argument.

In the versioned source snapshot, find the generated modules under
`.gsys/compile/python/<package hash>/gsys_generated_<discovery-root hash>/`. The build adds the
parent directory to `PYTHONPATH`. The parent directory's `registration.json` lists each module
under `collections` along with its instance parameters. Import the collections your Worker
needs in the native assembly. Keep the generated Activity and Nexus imports out of Workflow
modules.

The generator preserves leading underscores and uses Python name mangling for private Activity
methods. A literal Worker registration list identifies a native registration scope, and separate
Workers can reuse an identity. Duplicate identities in one generated collection produce a
warning. Use independent explicit registration when those definitions belong to separate Workers.
Inspection reports unknown membership when it cannot resolve the scope.

## Choose a package layout and entrypoint

Genesys supports flat and `src` layouts, setuptools `package-dir` and `packages.find.where`,
Poetry package source roots, and a uniform `package_dir` in `setup.cfg`. Declare console
entrypoints through `project.scripts`, Poetry scripts, or `console_scripts` in `setup.cfg`.
Genesys also recognizes modules with an `if __name__ == "__main__"` guard and `__main__.py`
files. If a named Worker directory has more than one candidate, choose the intended executable
with a native startup override.

## Build a native Worker environment

Run `gsys build .` from the project root. Genesys generates registration in the versioned
workspace before it runs native commands from each Python package directory. Install the package
manager required by your dependency inputs.

- With `uv.lock`, `uv sync --frozen` installs into `.venv`.
- With `poetry.lock`, `poetry install --no-interaction` uses an in-project `.venv`.
- Otherwise, Genesys creates an environment with `python3 -m venv .gsys/python-env`
  (`python` on Windows). Its interpreter runs `pip install .` for an installable package or `pip install -r requirements.txt` for a requirements-based application. Unlocked inputs resolve according to the package manager's rules. A Pipenv-only project needs a supported dependency input for production builds.

The environment's interpreter runs `compileall` over generated registration. The build record
identifies the workspace, package, generated registration, virtual environment, and native
launch executable when available. Build metadata lists the commands and available tool
versions.

Keep the package's relative layout and the workspace's absolute path. Console scripts can
embed the interpreter's absolute path, and the environment can refer to its base Python
installation by absolute path or symbolic link. Supply the compatible Python installation,
platform, and system libraries required by your dependencies.

## Start the native program

Read `manifestPath` in the published selector at `.gsys/compile/manifest.json`. Use `start.cwd`,
`start.executable`, `start.args`, and `start.env.PYTHONPATH` from the Worker entry of that
immutable manifest. A POSIX module launch uses this form.

```sh
cd /absolute/build/workspace/package
PYTHONPATH="/absolute/build/workspace/package/src:/absolute/build/workspace/.gsys/compile/python/PACKAGE_HASH" \
  /absolute/build/workspace/package/.gsys/python-env/bin/python -m example.temporal.workers.worker
```

For a console script, run the recorded executable in the environment's `bin` directory
(`Scripts` on Windows). If analysis finds no unique entrypoint, use your application's native
startup command. Read the source roots in the generated `registration.json` and add those
roots and the directory that contains `registration.json` to `PYTHONPATH`. Supply your
application's runtime settings with your deployment tools.

## Analysis and readiness limits

Runtime-created, conditional, or function-local definitions, wildcard re-exports, custom
decorators, external service contracts, nonuniform package mappings, and dynamic registration
expressions can exceed static resolution. Use explicit native registration and startup overrides
when needed. Discovery does not execute `setup.py` or build backends to find package paths.
Native build commands can execute build code.

Python sets `Worker.is_running` before native validation and polling finish. Supervision requires
native heartbeats attributed to the process generation and successful polls for every known
instance and task type. Dynamic Worker instances can leave whole-program coverage unknown.
Readiness and retirement require separate evidence.

## Validation

The reviewed API versions are Temporal Python SDK 1.36.1 and its Nexus dependency 1.5.0.
See the [Worker API](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/worker/_worker.py),
[Workflow API](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/workflow/_definition.py),
[Activity API](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/activity.py), and
[Nexus handler decorators](https://github.com/nexus-rpc/sdk-python/blob/1.5.0/src/nexusrpc/handler/_decorators.py).

Python 3.15.2 on macOS arm64 installed the package and dependencies and compiled the generated
registration in the mixed Go and Python build. `gsys dev` launched the Python Worker through the
recorded module command. The Worker ran both bound Activities, and the Go Workflow returned
`"HELLO, ADA!"`.

## Next steps

- Pass a Python Activity instance to generated registration in [Mixed-Language Projects](../../guides/mixed-language-projects.md).
- Use published startup commands in [Native Worker Deployment](../../guides/deployment.md).
