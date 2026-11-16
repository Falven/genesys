# Python native registration

Python analysis uses a packaged Python 3.11+ standard-library helper in isolated mode (`python3 -I`, or `python -I` on Windows). It parses supplied source with `ast` and package metadata with `tomllib`/`configparser`. It does not import the SDK, application modules, or build backends during discovery or emission.

The adapter recognizes multiple `@temporalio.workflow.defn` classes, `@temporalio.activity.defn` functions and methods, and `@nexusrpc.handler.service_handler` classes per entry. Imports, import aliases, explicit re-exports, relative imports, and module-level literal constants resolve statically. Native names remain independent of paths. `dynamic=True` denotes a native catch-all, while a computed name is unresolved. Workflow handlers remain on their original class. Nexus operation handlers and factory methods remain on the authored service instance; the generator does not reconstruct them. Nexus service names resolve through local imported `@nexusrpc.service` contracts or `service_handler(name=...)`.

Each discovery root produces separate ordinary Python modules for Workflows, Activities, and Nexus handlers. The compile metadata records their module names and instance parameters. Artifacts live under `.gsys/compile/python/<package hash>/gsys_generated_<discovery-root hash>/`; this parent directory is added to the native Worker process's `PYTHONPATH`. Native package discovery therefore does not pick up a second top-level generated source package.

Each module exposes `registrations(...)`, which returns the tuple accepted by the matching native `Worker` keyword: `workflows`, `activities`, or `nexus_service_handlers`. Functions and Workflow classes need no arguments. Bound Activity methods and Nexus handlers require typed, application-owned instance arguments listed in the generated function signature and metadata. The authored Worker passes instances from its existing constructors, factories, or dependency injection. Genesys calls no constructors and does not require a separate list of definitions. Import only the needed collection in each native assembly; Workflows do not import the generated Activity or Nexus collection.

The generator preserves leading underscores and mangles private Activity method access as Python does. Native literal Worker registration lists establish collision scopes. Separate Workers may reuse a name. A duplicate identity inside one generated aggregate produces a warning because that aggregate cannot be used together; explicit independent registration remains valid. Unknown Worker membership is reported instead of treated as a global scope.

Package context supports conventional flat and `src` layouts, setuptools `package-dir` and `packages.find.where`, Poetry package source roots, and setup.cfg's uniform `package_dir`. Console entrypoints come from `project.scripts`, Poetry scripts, or setup.cfg `console_scripts`. Otherwise, a module with an `if __name__ == "__main__"` guard or a `__main__.py` is a native executable candidate. More than one candidate in a named Worker directory remains ambiguous. Python module and script names are never inferred from Workflow names or Task Queues.

## Production output

Run `gsys build .` from the selected project. Genesys generates registration in the versioned workspace before it runs native build commands from the Python package directory.

- With `uv.lock`, `uv sync --frozen` installs into `.venv`.
- With `poetry.lock`, `poetry install --no-interaction` uses an in-project `.venv`.
- Otherwise, `python3 -m venv .gsys/python-env` creates a fresh environment. Its interpreter runs `pip install .` for an installable package or `pip install -r requirements.txt` for a requirements-based application. Unlocked inputs resolve according to the package manager's rules. A Pipenv-only project needs a supported dependency input for production builds.

The environment's interpreter runs `compileall` over the generated registration. The published record identifies the workspace, package directory, generated registration directory, virtual environment, and native launch executable when available. Build metadata records the commands and available tool versions. The snapshot retains the application source and assets alongside the installed dependencies and generated modules. Keep the package's relative layout and the versioned workspace's absolute path. Console scripts can embed the virtual environment interpreter's absolute path. The environment can also refer to its base Python installation through absolute paths or symbolic links. Supply the compatible Python installation, platform, and system libraries required by the installed packages.

Use `start.cwd`, `start.executable`, `start.args`, and `start.env.PYTHONPATH` from the Worker entry in `.gsys/compile/manifest.json`. For a module entrypoint, the recorded command has this form:

```sh
cd /absolute/build/workspace/package
PYTHONPATH="/absolute/build/workspace/package/src:/absolute/build/workspace/.gsys/compile/python/PACKAGE_HASH" \
  /absolute/build/workspace/package/.gsys/python-env/bin/python -m example.temporal.workers.worker
```

For an installed console script, run the recorded executable in the environment's `bin` directory (`Scripts` on Windows). If analysis cannot select a unique entrypoint, use the application’s native startup command. Find the source roots in the generated `registration.json` and add those roots and its directory to `PYTHONPATH`. The application's own tooling selects the program, supplies runtime settings, and controls distribution. A successful build confirms the native commands completed and the recorded paths exist. Worker readiness requires runtime evidence.

## Analysis and readiness limits

Valid runtime-created definitions, wildcard re-exports, conditional definitions, definitions local to a function, custom decorators, external service contracts, nonuniform package mappings, Pipenv environments, and dynamic registration expressions can exceed static resolution. Diagnostics preserve these as tooling limits. Explicit native assembly and startup overrides remain available. This adapter does not execute setup.py or arbitrary build-backend code to discover package paths. Builds can execute native build code.

Readiness is unavailable from static Python inspection. `Worker.is_running` is set before native validation and polling finish. Supervision requires native Worker heartbeats attributed to the process generation and successful polls for every known instance/task type; dynamic instance coverage remains unknown. Readiness does not authorize retirement of a required native deployment version.

API evidence was inspected at released [temporalio 1.36.1](https://github.com/temporalio/sdk-python/releases/tag/1.36.1): [Worker registration](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/worker/_worker.py), [Workflow decorators](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/workflow/_definition.py), and [Activity decorators](https://github.com/temporalio/sdk-python/blob/1.36.1/temporalio/activity.py). Its dependency is [nexus-rpc 1.5.0](https://github.com/nexus-rpc/sdk-python/blob/1.5.0/src/nexusrpc/handler/_decorators.py). These are source-level API checks, not runtime SDK compatibility evidence. No tests were added or run.
