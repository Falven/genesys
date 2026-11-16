import ast
from dataclasses import dataclass

from diagnostics import Diagnostics
from package_context import PackageContext
from source_index import FUNCTIONS, UNKNOWN, SourceIndex

MARKERS = {
    "temporalio.workflow.defn": "workflow",
    "temporalio.activity.defn": "activity",
    "nexusrpc.handler.service_handler": "nexus",
}


@dataclass
class Candidate:
    module: str
    node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
    symbol: str
    kind: str
    identity: dict
    owner: str
    accessible: bool


@dataclass
class SelectedDefinition:
    entry: dict
    record: dict
    candidate: Candidate
    source_module: str


class NativeDefinitions:
    def __init__(
        self, context: PackageContext, index: SourceIndex, diagnostics: Diagnostics
    ):
        self.context = context
        self.index = index
        self.diagnostics = diagnostics
        self._candidates: dict[str, Candidate] = {}
        self.records: list[dict] = []
        self.selected: dict[tuple[str, str], SelectedDefinition] = {}
        for name, module in index.modules.items():
            self._scan(name, module.tree.body)
        self._report_runtime_definitions()
        self._select_entries()
        self._resolve_registration_scopes()

    def _identity(self, node, decorator, module_name, kind):
        options = (
            {k.arg: k.value for k in decorator.keywords}
            if isinstance(decorator, ast.Call)
            else {}
        )
        dynamic = (
            self.index.literal(options["dynamic"], module_name)
            if "dynamic" in options
            else False
        )
        name = (
            self.index.literal(options["name"], module_name)
            if "name" in options
            else None
        )
        if kind == "nexus" and "service" in options:
            service = self.index.reference(options["service"], module_name)
            for owner, other in self.index.modules.items():
                contract = (
                    other.nodes.get((service or "")[len(owner) + 1 :])
                    if service and service.startswith(owner + ".")
                    else None
                )
                if isinstance(contract, ast.ClassDef):
                    dec = next(
                        (
                            d
                            for marker, d in self.index.decorators(contract, owner)
                            if marker == "nexusrpc.service"
                        ),
                        None,
                    )
                    if dec is not None:
                        return self._identity(contract, dec, owner, "nexus")
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
        if name is not None and (not isinstance(name, str)):
            return {"state": "unresolved", "reason": "Native name is not a string."}
        return {
            "state": "resolved",
            "name": name if kind == "nexus" and name is not None else name or node.name,
        }

    def _scan(self, module_name, body, classes=(), accessible=True):
        for node in body:
            if isinstance(node, (ast.ClassDef, *FUNCTIONS)):
                symbol = ".".join((*classes, node.name))
                for marker, decorator in self.index.decorators(node, module_name):
                    kind = MARKERS.get(marker)
                    if not kind:
                        continue
                    valid_shape = (
                        isinstance(node, ast.ClassDef)
                        if kind != "activity"
                        else isinstance(node, FUNCTIONS)
                    )
                    self._candidates[module_name + "." + symbol] = Candidate(
                        module=module_name,
                        node=node,
                        symbol=symbol,
                        kind=kind,
                        identity=self._identity(node, decorator, module_name, kind),
                        owner=".".join(classes),
                        accessible=accessible and valid_shape,
                    )
                if isinstance(node, ast.ClassDef):
                    self._scan(
                        module_name, node.body, (*classes, node.name), accessible
                    )
                else:
                    self._scan(module_name, node.body, (*classes, node.name), False)
            else:
                self._scan(
                    module_name, list(ast.iter_child_nodes(node)), classes, False
                )

    def _report_runtime_definitions(self):
        for module_name, module in self.index.modules.items():
            if module.path not in self.context.entries:
                continue
            decorator_calls = {
                id(d)
                for node in ast.walk(module.tree)
                if isinstance(node, (ast.ClassDef, *FUNCTIONS))
                for d in node.decorator_list
            }
            for node in ast.walk(module.tree):
                if (
                    isinstance(node, ast.Call)
                    and id(node) not in decorator_calls
                    and (self.index.reference(node.func, module_name) in MARKERS)
                ):
                    self.diagnostics.report(
                        "factory-definition-unresolved",
                        "Native definition decorators used as runtime calls require explicit native assembly; the call is not evaluated.",
                        module.path,
                        node,
                    )

    def _select_entries(self):
        for path, entry in sorted(self.context.entries.items()):
            module_name = self.index.paths.get(path)
            if not module_name or entry["role"] == "worker":
                continue
            exposed = [
                (key, item.symbol)
                for key, item in self._candidates.items()
                if item.module == module_name
            ]
            for alias, target in self.index.modules[module_name].aliases.items():
                resolved = self.index.canonical(target)
                if resolved:
                    exposed += [
                        (key, alias + key[len(resolved) :])
                        for key in self._candidates
                        if key == resolved or key.startswith(resolved + ".")
                    ]
            count = 0
            for key, exposed_symbol in exposed:
                candidate = self._candidates[key]
                if candidate.kind != entry["role"]:
                    continue
                count += 1
                node = candidate.node
                record = {
                    "id": path + ":" + exposed_symbol,
                    "source": {
                        "path": self.index.modules[candidate.module].path,
                        "line": node.lineno,
                        "column": node.col_offset + 1,
                    },
                    "entryId": entry["id"],
                    "language": "python",
                    "kind": candidate.kind,
                    "symbol": exposed_symbol,
                    "identity": candidate.identity,
                }
                if candidate.kind == "nexus" or (
                    candidate.kind == "activity" and candidate.owner
                ):
                    static = any(
                        (
                            marker
                            in (
                                candidate.module + ".staticmethod",
                                candidate.module + ".classmethod",
                                "builtins.staticmethod",
                                "builtins.classmethod",
                            )
                            for marker, _ in self.index.decorators(
                                node, candidate.module
                            )
                        )
                    )
                    if not static or candidate.kind == "nexus":
                        owner = (
                            exposed_symbol
                            if candidate.kind == "nexus"
                            else exposed_symbol.rsplit(".", 1)[0]
                        )
                        record["construction"] = {
                            "symbol": owner,
                            "reason": "Pass the application-owned instance; constructors and factories are not evaluated by Genesys.",
                        }
                native_decorators = self.index.decorators(node, candidate.module)
                custom_decorators = [
                    marker
                    for marker, _ in native_decorators
                    if marker not in MARKERS
                    and marker
                    not in (
                        candidate.module + ".staticmethod",
                        candidate.module + ".classmethod",
                        "builtins.staticmethod",
                        "builtins.classmethod",
                    )
                ]
                if custom_decorators:
                    record["identity"] = {
                        "state": "unresolved",
                        "reason": "Additional decorators may change the native definition or identity; runtime application behavior is preserved.",
                    }
                    candidate.identity = record["identity"]
                if candidate.owner and any(
                    part.startswith("__") and (not part.endswith("__"))
                    for part in candidate.owner.split(".")[1:]
                ):
                    candidate.accessible = False
                if not candidate.accessible:
                    self.diagnostics.report(
                        "definition-scope-unresolved",
                        "Conditional, nested-function, or invalid decorator placement requires explicit native assembly: "
                        + exposed_symbol,
                        path,
                        node,
                    )
                if record["identity"]["state"] == "unresolved":
                    self.diagnostics.report(
                        "identity-unresolved", record["identity"]["reason"], path, node
                    )
                self.records.append(record)
                self.selected.setdefault(
                    (entry["discoveryRoot"], key),
                    SelectedDefinition(entry, record, candidate, module_name),
                )
            if not count:
                self.diagnostics.report(
                    "no-static-definitions",
                    "No native "
                    + entry["role"]
                    + " decorator resolved in this entry. Factory-produced definitions and custom decorators require explicit native assembly.",
                    path,
                )

    def _resolve_registration_scopes(self):
        scopes = {}
        for module_name, module in self.index.modules.items():
            if any(
                module.path.startswith(path + "/")
                for path in self.context.nested_packages
            ):
                continue
            for node in ast.walk(module.tree):
                if (
                    not isinstance(node, ast.Call)
                    or self.index.reference(node.func, module_name)
                    != "temporalio.worker.Worker"
                ):
                    continue
                scope = (
                    module.path
                    + ":"
                    + str(node.lineno)
                    + ":"
                    + str(node.col_offset + 1)
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
                        values = module.values.get(values.id, values)
                    if not isinstance(values, (ast.List, ast.Tuple, ast.Set)):
                        self.diagnostics.report(
                            "registration-scope-unresolved",
                            "Worker "
                            + option.arg
                            + " is assembled dynamically; explicit native assembly is preserved and its membership is unresolved.",
                            module.path,
                            option.value,
                        )
                        continue
                    seen = {}
                    for expression in values.elts:
                        target = self.index.reference(expression, module_name)
                        candidate = self._candidates.get(target)
                        if candidate is None:
                            self.diagnostics.report(
                                "registration-member-unresolved",
                                "Worker registration member requires native runtime resolution: "
                                + ast.unparse(expression),
                                module.path,
                                expression,
                            )
                            continue
                        scopes.setdefault(target, set()).add(scope)
                        ident = candidate.identity
                        name = ident.get(
                            "name", "<dynamic>" if ident["state"] == "dynamic" else None
                        )
                        if name is not None and name in seen:
                            self.diagnostics.report(
                                "native-registration-collision",
                                "Duplicate native "
                                + option.arg
                                + " identity "
                                + repr(name)
                                + " in Worker scope "
                                + scope,
                                module.path,
                                expression,
                                "error",
                            )
                        seen[name] = target
        for (_, key), selection in self.selected.items():
            if len(scopes.get(key, set())) == 1:
                selection.record["registrationScope"] = next(iter(scopes[key]))
