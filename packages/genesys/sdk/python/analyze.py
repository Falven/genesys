"""Static Python SDK analysis. Input is source text; authored modules are never loaded."""

import ast
import configparser
import hashlib
import json
import keyword
import os
import posixpath
import sys
import tomllib

UNKNOWN = object()
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
MARKERS = {
    "temporalio.workflow.defn": "workflow",
    "temporalio.activity.defn": "activity",
    "nexusrpc.handler.service_handler": "nexus",
}


def main(data):
    package = data["package"]
    project_root = data["projectRoot"]
    root = package["root"]
    prefix = "" if root == "." else root + "/"
    sources = {p: s for p, s in data["sources"].items() if p.startswith(prefix)}
    nested_packages = {
        posixpath.dirname(path)
        for path in sources
        if posixpath.basename(path)
        in {"pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"}
        and (posixpath.dirname(path) or ".") != root
    }
    entries = {
        e["path"]: e for e in data["entries"] if e.get("packageId") == package["id"]
    }
    diagnostics, definitions, workers, artifacts = [], [], [], []

    def diagnostic(code, message, path=None, node=None, severity="warning"):
        item = {"code": "python." + code, "severity": severity, "message": message}
        if path:
            item["source"] = {"path": path}
            if node is not None:
                item["source"].update(line=node.lineno, column=node.col_offset + 1)
        diagnostics.append(item)

    manifest = prefix + "pyproject.toml"
    config = {}
    if manifest in sources:
        try:
            config = tomllib.loads(sources[manifest])
        except tomllib.TOMLDecodeError as error:
            diagnostic("invalid-package", str(error), manifest, severity="error")
    tool = config.get("tool", {})
    package_dirs = tool.get("setuptools", {}).get("package-dir", {})
    roots = []
    if package_dirs:
        if set(package_dirs) == {""} and isinstance(package_dirs[""], str):
            roots = [posixpath.normpath(prefix + package_dirs[""])]
        else:
            diagnostic(
                "package-layout-unresolved",
                "Multiple setuptools package-dir mappings require explicit native assembly.",
                manifest,
            )
    find = tool.get("setuptools", {}).get("packages", {})
    if not roots and isinstance(find, dict):
        roots = [
            posixpath.normpath(prefix + p)
            for p in find.get("find", {}).get("where", [])
        ]
    if not roots and "poetry" in tool and tool["poetry"].get("packages"):
        roots = sorted(
            {
                posixpath.normpath(prefix + p.get("from", "."))
                for p in tool["poetry"]["packages"]
            }
        )
    cfg_path = prefix + "setup.cfg"
    setup_cfg = configparser.ConfigParser(interpolation=None)
    if cfg_path in sources:
        try:
            setup_cfg.read_string(sources[cfg_path])
            if not roots and setup_cfg.has_option("options", "package_dir"):
                mappings = [
                    v.strip()
                    for v in setup_cfg.get("options", "package_dir").splitlines()
                    if v.strip()
                ]
                if len(mappings) == 1 and mappings[0].startswith("="):
                    roots = [posixpath.normpath(prefix + mappings[0][1:].strip())]
                else:
                    diagnostic(
                        "package-layout-unresolved",
                        "Nonuniform setup.cfg package_dir requires explicit native assembly.",
                        cfg_path,
                    )
        except configparser.Error as error:
            diagnostic("invalid-package", str(error), cfg_path, severity="error")
    if not roots:
        roots = [
            prefix + "src"
            if any(p.startswith(prefix + "src/") and p.endswith(".py") for p in sources)
            else root
        ]
    roots = sorted(set(roots), key=lambda value: (-len(value), value))
    for source_root in roots:
        if source_root == ".." or source_root.startswith(("../", "/")):
            diagnostic(
                "package-layout-unresolved",
                "Python source root must be inside the isolated project.",
                manifest,
                severity="error",
            )
            return {
                "definitions": [],
                "diagnostics": diagnostics,
                "workers": [],
                "artifacts": [],
            }
    modules, paths = {}, {}
    for path, source in sorted(sources.items()):
        if not path.endswith(".py"):
            continue
        source_root = next(
            (r for r in roots if r == "." or path.startswith(r + "/")), None
        )
        if source_root is None:
            if path in entries:
                diagnostic(
                    "module-unresolved",
                    "Source is outside the native import roots.",
                    path,
                )
            continue
        relative = path if source_root == "." else path[len(source_root) + 1 :]
        parts = relative[:-3].split("/")
        if parts[-1] == "__init__":
            parts.pop()
        if not parts or any(
            not p.isidentifier() or keyword.iskeyword(p) for p in parts
        ):
            if path in entries:
                diagnostic(
                    "module-unresolved",
                    "Source path does not form an importable Python module.",
                    path,
                )
            continue
        name = ".".join(parts)
        try:
            tree = ast.parse(source, filename=path)
        except SyntaxError as error:
            diagnostic("syntax", str(error), path, severity="error")
            continue
        if name in modules:
            diagnostic(
                "module-collision",
                "Multiple source files resolve to module " + name,
                path,
                severity="error",
            )
            continue
        modules[name] = {
            "path": path,
            "root": source_root,
            "tree": tree,
            "aliases": {},
            "values": {},
            "nodes": {},
            "unstable": set(),
        }
        paths[path] = name

    # Resolve imports and re-exports without importing packages or resolving site-packages.
    for name, module in modules.items():
        aliases, values = module["aliases"], module["values"]
        bound = set()
        for node in module["tree"].body:
            names = []
            if isinstance(node, ast.Import):
                names = [item.asname or item.name.split(".")[0] for item in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [item.asname or item.name for item in node.names]
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = (
                    node.targets if isinstance(node, ast.Assign) else [node.target]
                )
                names = [
                    target.id for target in targets if isinstance(target, ast.Name)
                ]
            elif isinstance(node, (ast.ClassDef, *FUNCTIONS)):
                names = [node.name]
            for binding in names:
                same_module_import = isinstance(node, ast.Import) and any(
                    (item.asname or item.name.split(".")[0]) == binding
                    and aliases.get(binding)
                    == (item.name if item.asname else item.name.split(".")[0])
                    for item in node.names
                )
                if binding in bound and not same_module_import:
                    module["unstable"].add(binding)
                    if module["path"] in entries:
                        diagnostic(
                            "rebound-name-unresolved",
                            "Repeated binding requires runtime resolution: " + binding,
                            module["path"],
                            node,
                        )
                bound.add(binding)
            if isinstance(node, ast.Import):
                for item in node.names:
                    aliases[item.asname or item.name.split(".")[0]] = (
                        item.name if item.asname else item.name.split(".")[0]
                    )
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    parent = (
                        name.split(".")
                        if module["path"].endswith("/__init__.py")
                        else name.split(".")[:-1]
                    )
                    base = ".".join(
                        parent[: len(parent) - node.level + 1]
                        + ([base] if base else [])
                    )
                for item in node.names:
                    if item.name == "*":
                        if module["path"] in entries:
                            diagnostic(
                                "wildcard-import-unresolved",
                                "Wildcard exports require explicit native assembly; no application module was imported.",
                                module["path"],
                                node,
                            )
                    else:
                        aliases[item.asname or item.name] = base + "." + item.name
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                targets = (
                    node.targets if isinstance(node, ast.Assign) else [node.target]
                )
                for target in targets:
                    if isinstance(target, ast.Name) and node.value is not None:
                        values[target.id] = node.value
            elif isinstance(node, (ast.ClassDef, *FUNCTIONS)):
                module["nodes"][node.name] = node

    def reference(node, module_name, seen=()):
        if isinstance(node, ast.Name):
            if node.id in modules[module_name]["unstable"]:
                return None
            value = modules[module_name]["aliases"].get(
                node.id, module_name + "." + node.id
            )
        elif isinstance(node, ast.Attribute):
            parent = reference(node.value, module_name, seen)
            return canonical(parent + "." + node.attr, seen) if parent else None
        else:
            return None
        return canonical(value, seen)

    def canonical(value, seen=()):
        if value is None or value in seen:
            return value
        for module_name in sorted(modules, key=len, reverse=True):
            if value.startswith(module_name + "."):
                tail = value[len(module_name) + 1 :]
                first, _, rest = tail.partition(".")
                if first in modules[module_name]["unstable"]:
                    return None
                alias = modules[module_name]["aliases"].get(first)
                if alias:
                    return canonical(
                        alias + ("." + rest if rest else ""), (*seen, value)
                    )
                break
        return value

    def literal(node, module_name, seen=()):
        if node is None:
            return UNKNOWN
        try:
            return ast.literal_eval(node)
        except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
            pass
        ref = reference(node, module_name)
        if ref and ref not in seen:
            for owner in sorted(modules, key=len, reverse=True):
                if ref.startswith(owner + "."):
                    value = modules[owner]["values"].get(ref[len(owner) + 1 :])
                    if value is not None:
                        return literal(value, owner, (*seen, ref))
                    break
        return UNKNOWN

    def decorators(node, module_name):
        return [
            (reference(d.func if isinstance(d, ast.Call) else d, module_name), d)
            for d in node.decorator_list
        ]

    def identity(node, decorator, module_name, kind):
        options = (
            {k.arg: k.value for k in decorator.keywords}
            if isinstance(decorator, ast.Call)
            else {}
        )
        dynamic = (
            literal(options["dynamic"], module_name) if "dynamic" in options else False
        )
        name = literal(options["name"], module_name) if "name" in options else None
        if kind == "nexus" and "service" in options:
            service = reference(options["service"], module_name)
            for owner, other in modules.items():
                contract = (
                    other["nodes"].get((service or "")[len(owner) + 1 :])
                    if service and service.startswith(owner + ".")
                    else None
                )
                if isinstance(contract, ast.ClassDef):
                    dec = next(
                        (
                            d
                            for marker, d in decorators(contract, owner)
                            if marker == "nexusrpc.service"
                        ),
                        None,
                    )
                    if dec is not None:
                        return identity(contract, dec, owner, "nexus")
            return {
                "state": "unresolved",
                "reason": "Nexus service contract could not be resolved statically.",
            }
        if dynamic is UNKNOWN or name is UNKNOWN or None in options:
            return {
                "state": "unresolved",
                "reason": "Decorator options contain expressions that cannot be resolved statically.",
            }
        if dynamic is True:
            return {
                "state": "dynamic",
                "reason": "Native dynamic catch-all definition.",
            }
        if name is not None and not isinstance(name, str):
            return {"state": "unresolved", "reason": "Native name is not a string."}
        return {
            "state": "resolved",
            "name": (
                name if kind == "nexus" and name is not None else name or node.name
            ),
        }

    candidates = {}

    def scan(module_name, body, classes=(), accessible=True):
        for node in body:
            if isinstance(node, (ast.ClassDef, *FUNCTIONS)):
                symbol = ".".join((*classes, node.name))
                for marker, decorator in decorators(node, module_name):
                    kind = MARKERS.get(marker)
                    if not kind:
                        continue
                    valid_shape = (
                        isinstance(node, ast.ClassDef)
                        if kind != "activity"
                        else isinstance(node, FUNCTIONS)
                    )
                    candidates[module_name + "." + symbol] = {
                        "module": module_name,
                        "node": node,
                        "symbol": symbol,
                        "kind": kind,
                        "identity": identity(node, decorator, module_name, kind),
                        "owner": ".".join(classes),
                        "accessible": accessible and valid_shape,
                    }
                if isinstance(node, ast.ClassDef):
                    scan(module_name, node.body, (*classes, node.name), accessible)
                else:
                    scan(module_name, node.body, (*classes, node.name), False)
            else:
                scan(module_name, list(ast.iter_child_nodes(node)), classes, False)

    for name, module in modules.items():
        scan(name, module["tree"].body)

    for module_name, module in modules.items():
        if module["path"] not in entries:
            continue
        decorator_calls = {
            id(d)
            for node in ast.walk(module["tree"])
            if isinstance(node, (ast.ClassDef, *FUNCTIONS))
            for d in node.decorator_list
        }
        for node in ast.walk(module["tree"]):
            if (
                isinstance(node, ast.Call)
                and id(node) not in decorator_calls
                and reference(node.func, module_name) in MARKERS
            ):
                diagnostic(
                    "factory-definition-unresolved",
                    "Native definition decorators used as runtime calls require explicit native assembly; the call is not evaluated.",
                    module["path"],
                    node,
                )

    selected = {}
    for path, entry in sorted(entries.items()):
        module_name = paths.get(path)
        if not module_name or entry["role"] == "worker":
            continue
        exposed = [
            (key, item["symbol"])
            for key, item in candidates.items()
            if item["module"] == module_name
        ]
        for alias, target in modules[module_name]["aliases"].items():
            resolved = canonical(target)
            if resolved:
                exposed += [
                    (key, alias + key[len(resolved) :])
                    for key in candidates
                    if key == resolved or key.startswith(resolved + ".")
                ]
        count = 0
        for key, exposed_symbol in exposed:
            candidate = candidates[key]
            if candidate["kind"] != entry["role"]:
                continue
            count += 1
            node = candidate["node"]
            record = {
                "id": path + ":" + exposed_symbol,
                "source": {
                    "path": modules[candidate["module"]]["path"],
                    "line": node.lineno,
                    "column": node.col_offset + 1,
                },
                "entryId": entry["id"],
                "language": "python",
                "kind": candidate["kind"],
                "symbol": exposed_symbol,
                "identity": candidate["identity"],
            }
            if (
                candidate["kind"] == "nexus"
                or candidate["kind"] == "activity"
                and candidate["owner"]
            ):
                static = any(
                    marker
                    in (
                        candidate["module"] + ".staticmethod",
                        candidate["module"] + ".classmethod",
                        "builtins.staticmethod",
                        "builtins.classmethod",
                    )
                    for marker, _ in decorators(node, candidate["module"])
                )
                if not static or candidate["kind"] == "nexus":
                    owner = (
                        exposed_symbol
                        if candidate["kind"] == "nexus"
                        else exposed_symbol.rsplit(".", 1)[0]
                    )
                    record["construction"] = {
                        "symbol": owner,
                        "reason": "Pass the application-owned instance; constructors and factories are not evaluated by Genesys.",
                    }
            native_decorators = decorators(node, candidate["module"])
            custom_decorators = [
                marker
                for marker, _ in native_decorators
                if marker not in MARKERS
                and marker
                not in (
                    candidate["module"] + ".staticmethod",
                    candidate["module"] + ".classmethod",
                    "builtins.staticmethod",
                    "builtins.classmethod",
                )
            ]
            if custom_decorators:
                record["identity"] = {
                    "state": "unresolved",
                    "reason": "Additional decorators may change the native definition or identity; runtime application behavior is preserved.",
                }
                candidate["identity"] = record["identity"]
            if candidate["owner"] and any(
                part.startswith("__") and not part.endswith("__")
                for part in candidate["owner"].split(".")[1:]
            ):
                candidate["accessible"] = False
            if not candidate["accessible"]:
                diagnostic(
                    "definition-scope-unresolved",
                    "Conditional, nested-function, or invalid decorator placement requires explicit native assembly: "
                    + exposed_symbol,
                    path,
                    node,
                )
            if record["identity"]["state"] == "unresolved":
                diagnostic(
                    "identity-unresolved", record["identity"]["reason"], path, node
                )
            definitions.append(record)
            # A native definition re-exported twice is registered once in a collection.
            selected.setdefault(
                (entry["discoveryRoot"], key), (entry, record, candidate, module_name)
            )
        if not count:
            diagnostic(
                "no-static-definitions",
                "No native "
                + entry["role"]
                + " decorator resolved in this entry. Factory-produced definitions and custom decorators require explicit native assembly.",
                path,
            )

    # Only native Worker calls establish authored registration scopes.
    scopes = {}
    for module_name, module in modules.items():
        if any(module["path"].startswith(path + "/") for path in nested_packages):
            continue
        for node in ast.walk(module["tree"]):
            if (
                not isinstance(node, ast.Call)
                or reference(node.func, module_name) != "temporalio.worker.Worker"
            ):
                continue
            scope = (
                module["path"] + ":" + str(node.lineno) + ":" + str(node.col_offset + 1)
            )
            for option in node.keywords:
                if option.arg not in (
                    "workflows",
                    "activities",
                    "nexus_service_handlers",
                ):
                    continue
                values = option.value
                if isinstance(values, ast.Name):
                    values = module["values"].get(values.id, values)
                if not isinstance(values, (ast.List, ast.Tuple, ast.Set)):
                    diagnostic(
                        "registration-scope-unresolved",
                        "Worker "
                        + option.arg
                        + " is assembled dynamically; explicit native assembly is preserved and its membership is unresolved.",
                        module["path"],
                        option.value,
                    )
                    continue
                seen = {}
                for expression in values.elts:
                    target = reference(expression, module_name)
                    candidate = candidates.get(target)
                    if candidate is None:
                        diagnostic(
                            "registration-member-unresolved",
                            "Worker registration member requires native runtime resolution: "
                            + ast.unparse(expression),
                            module["path"],
                            expression,
                        )
                        continue
                    scopes.setdefault(target, set()).add(scope)
                    ident = candidate["identity"]
                    name = ident.get(
                        "name", "<dynamic>" if ident["state"] == "dynamic" else None
                    )
                    if name is not None and name in seen:
                        diagnostic(
                            "native-registration-collision",
                            "Duplicate native "
                            + option.arg
                            + " identity "
                            + repr(name)
                            + " in Worker scope "
                            + scope,
                            module["path"],
                            expression,
                            "error",
                        )
                    seen[name] = target
    for (_, key), (_, record, _, _) in selected.items():
        if len(scopes.get(key, set())) == 1:
            record["registrationScope"] = next(iter(scopes[key]))

    groups = {}
    for (discovery_root, key), value in sorted(selected.items()):
        entry, record, candidate, module_name = value
        if candidate["accessible"]:
            groups.setdefault((discovery_root, record["kind"]), []).append(value)

    generated_modules = []
    metadata_root = (
        ".gsys/compile/python/"
        + hashlib.sha256(package["id"].encode()).hexdigest()[:12]
    )
    for (discovery_root, kind), members in sorted(groups.items()):
        import_roots = {modules[m[3]]["root"] for m in members}
        if len(import_roots) != 1:
            diagnostic(
                "registration-layout-unresolved",
                "One discovery root spans multiple Python import roots; use explicit native assembly.",
                discovery_root,
            )
            continue
        namespace = (
            "gsys_generated_" + hashlib.sha256(discovery_root.encode()).hexdigest()[:12]
        )
        module_name = {
            "workflow": "workflows",
            "activity": "activities",
            "nexus": "nexus",
        }[kind]
        directory = posixpath.join(metadata_root, namespace)
        filename = posixpath.join(directory, module_name + ".py")
        lines = [
            "# Generated by Genesys. Application code owns Worker options and construction.",
            "from __future__ import annotations",
            "",
        ]
        expressions, parameters, imports, seen_names = [], [], {}, {}
        for entry, record, candidate, source_module in members:
            native_name = record["identity"].get(
                "name",
                "<dynamic>" if record["identity"]["state"] == "dynamic" else None,
            )
            if native_name is not None and native_name in seen_names:
                diagnostic(
                    "generated-registration-collision",
                    "Duplicate "
                    + kind
                    + " identity "
                    + repr(native_name)
                    + " in generated collection "
                    + namespace
                    + "."
                    + module_name
                    + "; explicit independent Worker scopes remain valid.",
                    record["source"]["path"],
                    candidate["node"],
                    "warning",
                )
            seen_names[native_name] = record
            alias = imports.setdefault(source_module, "_module_" + str(len(imports)))
            symbol = record["symbol"]
            if "construction" in record:
                owner = record["construction"]["symbol"]
                owner_key = source_module + "." + owner
                param = next((p for p in parameters if p[0] == owner_key), None)
                if param is None:
                    param = (
                        owner_key,
                        "instance_" + str(len(parameters)),
                        alias + "." + owner,
                    )
                    parameters.append(param)
                if kind == "nexus":
                    expressions.append(param[1])
                else:
                    method = symbol.rsplit(".", 1)[1]
                    if method.startswith("__") and not method.endswith("__"):
                        method = (
                            "_"
                            + candidate["owner"].rsplit(".", 1)[-1].lstrip("_")
                            + method
                        )
                    expressions.append(param[1] + "." + method)
            else:
                if (
                    kind == "activity"
                    and candidate["owner"]
                    and candidate["node"].name.startswith("__")
                    and not candidate["node"].name.endswith("__")
                ):
                    owner, method = symbol.rsplit(".", 1)
                    symbol = (
                        owner
                        + "._"
                        + candidate["owner"].rsplit(".", 1)[-1].lstrip("_")
                        + method
                    )
                expressions.append(alias + "." + symbol)
        lines += [
            "import " + module + " as " + alias for module, alias in imports.items()
        ]
        lines += [
            "",
            "",
            "def registrations("
            + ", ".join(name + ": " + type_name for _, name, type_name in parameters)
            + "):",
            "    return (",
            *["        " + expression + "," for expression in expressions],
            "    )",
            "",
        ]
        for artifact_path, content in [
            (
                posixpath.join(directory, "__init__.py"),
                "# Generated Python registration package.\n",
            ),
            (filename, "\n".join(lines)),
        ]:
            if artifact_path in sources:
                diagnostic(
                    "generated-path-conflict",
                    "Generated output would replace authored source: " + artifact_path,
                    artifact_path,
                    severity="error",
                )
            elif not any(a["path"] == artifact_path for a in artifacts):
                artifacts.append(
                    {"path": artifact_path, "content": content, "kind": "registration"}
                )
        generated_modules.append(
            {
                "discoveryRoot": discovery_root,
                "kind": kind,
                "module": namespace + "." + module_name,
                "function": "registrations",
                "instances": [
                    {"parameter": name, "type": owner} for owner, name, _ in parameters
                ],
            }
        )

    # Console scripts are native entrypoint declarations. __main__ guards are native module entries.
    scripts = dict(config.get("project", {}).get("scripts", {}))
    for name, value in tool.get("poetry", {}).get("scripts", {}).items():
        scripts.setdefault(
            name, value if isinstance(value, str) else value.get("reference")
        )
    if setup_cfg.has_section("options.entry_points"):
        for line in setup_cfg.get(
            "options.entry_points", "console_scripts", fallback=""
        ).splitlines():
            if "=" in line:
                name, value = line.split("=", 1)
                scripts.setdefault(name.strip(), value.strip())
    python = "python" if sys.platform == "win32" else "python3"
    worker_groups = {}
    for path, entry in entries.items():
        if entry["role"] == "worker" and entry.get("workerName"):
            worker_groups.setdefault(entry["workerName"], []).append((path, entry))
    for name, worker_entries in sorted(worker_groups.items()):
        choices = []
        for path, entry in worker_entries:
            module_name = paths.get(path)
            if not module_name:
                continue
            module = modules[module_name]
            script_matches = [
                (script, value)
                for script, value in scripts.items()
                if isinstance(value, str)
                and value.split(":", 1)[0] == module_name
                and ":" in value
            ]
            for script, value in script_matches:
                choices.append((path, module_name, script, value))
            if not script_matches:
                executable = path.endswith("/__main__.py") or any(
                    isinstance(node, ast.If)
                    and isinstance(node.test, ast.Compare)
                    and len(node.test.ops) == 1
                    and isinstance(node.test.ops[0], ast.Eq)
                    and isinstance(node.test.left, ast.Name)
                    and node.test.left.id == "__name__"
                    and len(node.test.comparators) == 1
                    and isinstance(node.test.comparators[0], ast.Constant)
                    and node.test.comparators[0].value == "__main__"
                    for node in module["tree"].body
                )
                if executable:
                    choices.append((path, module_name, None, None))
        worker = {
            "id": package["id"] + ":" + name,
            "name": name,
            "language": "python",
            "packageId": package["id"],
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
            diagnostic(
                "worker-entrypoint-unresolved",
                "Expected one native executable entry for Worker "
                + name
                + "; found "
                + str(len(choices))
                + ": "
                + ", ".join(c[2] or c[1] for c in choices)
                + ". An explicit native startup override remains available.",
                worker_entries[0][0],
            )
        else:
            path, module_name, script, target = choices[0]
            worker["source"] = {"path": path}
            # Each build creates its own environment. Never start an installed copy from a prior build.
            env_dir = ".gsys/python-env"
            env_python = env_dir + (
                "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
            )
            worker["build"] = [
                {"executable": python, "args": ["-m", "venv", env_dir], "cwd": root}
            ]
            installable = bool(
                config.get("build-system")
                or config.get("project")
                or "poetry" in tool
                or prefix + "setup.py" in sources
                or cfg_path in sources
            )
            if installable:
                worker["build"].append(
                    {
                        "executable": env_python,
                        "args": ["-m", "pip", "install", "."],
                        "cwd": root,
                    }
                )
            elif prefix + "requirements.txt" in sources:
                worker["build"].append(
                    {
                        "executable": env_python,
                        "args": ["-m", "pip", "install", "-r", "requirements.txt"],
                        "cwd": root,
                    }
                )
            else:
                diagnostic(
                    "dependencies-unresolved",
                    "No installable package or requirements.txt can supply the Worker dependencies.",
                    path,
                )
            if prefix + "uv.lock" in sources:
                env_dir = ".venv"
                env_python = env_dir + (
                    "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
                )
                worker["build"] = [
                    {"executable": "uv", "args": ["sync", "--frozen"], "cwd": root}
                ]
            elif prefix + "poetry.lock" in sources:
                env_dir = ".venv"
                env_python = env_dir + (
                    "/Scripts/python.exe" if sys.platform == "win32" else "/bin/python"
                )
                worker["build"] = [
                    {
                        "executable": "poetry",
                        "args": ["install", "--no-interaction"],
                        "cwd": root,
                        "env": {
                            "POETRY_VIRTUALENVS_IN_PROJECT": "true",
                            "VIRTUAL_ENV": "",
                            "CONDA_PREFIX": "",
                        },
                    }
                ]
            elif prefix + "Pipfile.lock" in sources or prefix + "Pipfile" in sources:
                diagnostic(
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
                        posixpath.relpath(metadata_root, root),
                    ],
                    "cwd": root,
                }
            )
            if script:
                executable = env_dir + (
                    "/Scripts/" + script + ".exe"
                    if sys.platform == "win32"
                    else "/bin/" + script
                )
                worker["start"] = {"executable": executable, "args": [], "cwd": root}
            else:
                worker["start"] = {
                    "executable": env_python,
                    "args": ["-m", module_name],
                    "cwd": root,
                }
            # Resolve source and generated modules only within the corresponding build.
            worker["start"]["env"] = {
                "PYTHONPATH": (";" if sys.platform == "win32" else ":").join(
                    posixpath.relpath(p, root) for p in [*roots, metadata_root]
                )
            }
        workers.append(worker)
    for worker in workers:
        for command in [
            *worker.get("build", []),
            *([worker["start"]] if "start" in worker else []),
        ]:
            cwd = os.path.normpath(os.path.join(project_root, command["cwd"]))
            if "/" in command["executable"]:
                command["executable"] = os.path.normpath(
                    os.path.join(cwd, command["executable"])
                )
            command["cwd"] = cwd
            if "PYTHONPATH" in command.get("env", {}):
                command["env"]["PYTHONPATH"] = os.pathsep.join(
                    os.path.normpath(os.path.join(project_root, p))
                    for p in [*roots, metadata_root]
                )
    artifacts.append(
        {
            "path": metadata_root + "/registration.json",
            "kind": "metadata",
            "content": json.dumps(
                {
                    "sdkSourceVersion": "1.36.1",
                    "nexusSourceVersion": "1.5.0",
                    "package": package["id"],
                    "importRoots": roots,
                    "collections": generated_modules,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
        }
    )
    diagnostic(
        "sdk-version-evidence",
        "Registration APIs inspected at temporalio 1.36.1 and nexus-rpc 1.5.0. Authored dependency resolution and runtime compatibility require the native build; static analysis does not import the SDK.",
        manifest if manifest in sources else root,
        severity="info",
    )
    return {
        "definitions": definitions,
        "diagnostics": diagnostics,
        "workers": workers,
        "artifacts": artifacts,
    }


if __name__ == "__main__":
    json.dump(main(json.load(sys.stdin)), sys.stdout, sort_keys=True)
