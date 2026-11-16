import ast
import os
import posixpath
import sys
from dataclasses import dataclass

from diagnostics import Diagnostics
from package_context import PackageContext
from source_index import SourceIndex


@dataclass(frozen=True)
class Entrypoint:
    path: str
    module: str
    script: str | None


def plan_workers(
    context: PackageContext,
    index: SourceIndex,
    metadata_root: str,
    diagnostics: Diagnostics,
) -> list[dict]:
    workers = []
    scripts = _console_scripts(context)
    worker_groups = {}
    for path, entry in context.entries.items():
        if entry["role"] == "worker" and entry.get("workerName"):
            worker_groups.setdefault(entry["workerName"], []).append((path, entry))
    for name, worker_entries in sorted(worker_groups.items()):
        choices = _entrypoints(worker_entries, index, scripts)
        worker = {
            "id": context.package["id"] + ":" + name,
            "name": name,
            "language": "python",
            "packageId": context.package["id"],
            "source": {"path": worker_entries[0][0]},
            "readiness": {
                "state": "unavailable",
                "description": "Worker.is_running is not polling readiness. Require native heartbeats attributed to the process generation plus successful polling for all known instances. Dynamic instance coverage remains unknown.",
                "evidence": [
                    "Temporal Worker heartbeat host/process/start time",
                    "Native poll success per instance and task type",
                ],
            },
        }
        if len(choices) != 1:
            diagnostics.report(
                "worker-entrypoint-unresolved",
                "Expected one native executable entry for Worker "
                + name
                + "; found "
                + str(len(choices))
                + ": "
                + ", ".join(choice.script or choice.module for choice in choices)
                + ". An explicit native startup override remains available.",
                worker_entries[0][0],
            )
        else:
            _configure_commands(worker, choices[0], context, metadata_root, diagnostics)
        workers.append(worker)
    _resolve_command_paths(workers, context, metadata_root)
    return workers


def _console_scripts(context):
    scripts = dict(context.config.get("project", {}).get("scripts", {}))
    for name, value in context.tool.get("poetry", {}).get("scripts", {}).items():
        scripts.setdefault(
            name, value if isinstance(value, str) else value.get("reference")
        )
    if context.setup_cfg.has_section("options.entry_points"):
        for line in context.setup_cfg.get(
            "options.entry_points", "console_scripts", fallback=""
        ).splitlines():
            if "=" in line:
                name, value = line.split("=", 1)
                scripts.setdefault(name.strip(), value.strip())
    return scripts


def _entrypoints(worker_entries, index, scripts):
    choices = []
    for path, entry in worker_entries:
        module_name = index.paths.get(path)
        if not module_name:
            continue
        module = index.modules[module_name]
        script_matches = [
            (script, value)
            for script, value in scripts.items()
            if isinstance(value, str)
            and value.split(":", 1)[0] == module_name
            and (":" in value)
        ]
        for script, value in script_matches:
            choices.append(Entrypoint(path, module_name, script))
        if not script_matches:
            executable = path.endswith("/__main__.py") or any(
                isinstance(node, ast.If)
                and isinstance(node.test, ast.Compare)
                and (len(node.test.ops) == 1)
                and isinstance(node.test.ops[0], ast.Eq)
                and isinstance(node.test.left, ast.Name)
                and (node.test.left.id == "__name__")
                and (len(node.test.comparators) == 1)
                and isinstance(node.test.comparators[0], ast.Constant)
                and (node.test.comparators[0].value == "__main__")
                for node in module.tree.body
            )
            if executable:
                choices.append(Entrypoint(path, module_name, None))
    return choices


def _configure_commands(worker, entrypoint, context, metadata_root, diagnostics):
    python = "python" if sys.platform == "win32" else "python3"
    path = entrypoint.path
    module_name = entrypoint.module
    script = entrypoint.script
    worker["source"] = {"path": path}
    env_dir = ".gsys/python-env"
    env_python = env_dir + (
        "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
    )
    worker["build"] = [
        {"executable": python, "args": ["-m", "venv", env_dir], "cwd": context.root}
    ]
    installable = bool(
        context.config.get("build-system")
        or context.config.get("project")
        or "poetry" in context.tool
        or (context.prefix + "setup.py" in context.sources)
        or (context.cfg_path in context.sources)
    )
    if installable:
        worker["build"].append(
            {
                "executable": env_python,
                "args": ["-m", "pip", "install", "."],
                "cwd": context.root,
            }
        )
    elif context.prefix + "requirements.txt" in context.sources:
        worker["build"].append(
            {
                "executable": env_python,
                "args": ["-m", "pip", "install", "-r", "requirements.txt"],
                "cwd": context.root,
            }
        )
    else:
        diagnostics.report(
            "dependencies-unresolved",
            "No installable package or requirements.txt can supply the Worker dependencies.",
            path,
        )
    if context.prefix + "uv.lock" in context.sources:
        env_dir = ".venv"
        env_python = env_dir + (
            "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
        )
        worker["build"] = [
            {"executable": "uv", "args": ["sync", "--frozen"], "cwd": context.root}
        ]
    elif context.prefix + "poetry.lock" in context.sources:
        env_dir = ".venv"
        env_python = env_dir + (
            "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
        )
        worker["build"] = [
            {
                "executable": "poetry",
                "args": ["install", "--no-interaction"],
                "cwd": context.root,
                "env": {
                    "POETRY_VIRTUALENVS_IN_PROJECT": "true",
                    "VIRTUAL_ENV": "",
                    "CONDA_PREFIX": "",
                },
            }
        ]
    elif (
        context.prefix + "Pipfile.lock" in context.sources
        or context.prefix + "Pipfile" in context.sources
    ):
        diagnostics.report(
            "package-manager-unresolved",
            "Pipenv dependency resolution is not implemented; supply an explicit native startup environment. This is a tooling limit, not a Python SDK limit.",
            path,
        )
    worker["build"].append(
        {
            "executable": env_python,
            "args": [
                "-m",
                "compileall",
                "-q",
                posixpath.relpath(metadata_root, context.root),
            ],
            "cwd": context.root,
        }
    )
    if script:
        executable = env_dir + (
            "/Scripts/" + script + ".exe"
            if sys.platform == "win32"
            else "/bin/" + script
        )
        worker["start"] = {"executable": executable, "args": [], "cwd": context.root}
    else:
        worker["start"] = {
            "executable": env_python,
            "args": ["-m", module_name],
            "cwd": context.root,
        }
    worker["start"]["env"] = {
        "PYTHONPATH": (";" if sys.platform == "win32" else ":").join(
            posixpath.relpath(p, context.root) for p in [*context.roots, metadata_root]
        )
    }


def _resolve_command_paths(workers, context, metadata_root):
    for worker in workers:
        for command in [
            *worker.get("build", []),
            *([worker["start"]] if "start" in worker else []),
        ]:
            cwd = os.path.normpath(os.path.join(context.project_root, command["cwd"]))
            if "/" in command["executable"]:
                command["executable"] = os.path.normpath(
                    os.path.join(cwd, command["executable"])
                )
            command["cwd"] = cwd
            if "PYTHONPATH" in command.get("env", {}):
                command["env"]["PYTHONPATH"] = os.pathsep.join(
                    os.path.normpath(os.path.join(context.project_root, p))
                    for p in [*context.roots, metadata_root]
                )
