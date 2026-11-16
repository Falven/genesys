import ast
import keyword
from dataclasses import dataclass, field

from diagnostics import Diagnostics
from package_context import PackageContext

UNKNOWN = object()
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


@dataclass
class SourceModule:
    path: str
    root: str
    tree: ast.Module
    aliases: dict[str, str] = field(default_factory=dict)
    values: dict[str, ast.expr] = field(default_factory=dict)
    nodes: dict[str, ast.AST] = field(default_factory=dict)
    unstable: set[str] = field(default_factory=set)


class SourceIndex:
    def __init__(self, context: PackageContext, diagnostics: Diagnostics):
        self.context = context
        self.diagnostics = diagnostics
        self.modules: dict[str, SourceModule] = {}
        self.paths: dict[str, str] = {}
        self._parse_modules()
        self._index_bindings()

    def _parse_modules(self):
        for path, source in sorted(self.context.sources.items()):
            if not path.endswith(".py"):
                continue
            source_root = next(
                (r for r in self.context.roots if r == "." or path.startswith(r + "/")),
                None,
            )
            if source_root is None:
                if path in self.context.entries:
                    self.diagnostics.report(
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
                if path in self.context.entries:
                    self.diagnostics.report(
                        "module-unresolved",
                        "Source path does not form an importable Python module.",
                        path,
                    )
                continue
            name = ".".join(parts)
            try:
                tree = ast.parse(source, filename=path)
            except SyntaxError as error:
                self.diagnostics.report("syntax", str(error), path, severity="error")
                continue
            if name in self.modules:
                self.diagnostics.report(
                    "module-collision",
                    "Multiple source files resolve to module " + name,
                    path,
                    severity="error",
                )
                continue
            self.modules[name] = SourceModule(path=path, root=source_root, tree=tree)
            self.paths[path] = name

    def _index_bindings(self):
        for name, module in self.modules.items():
            aliases, values = (module.aliases, module.values)
            bound = set()
            for node in module.tree.body:
                names = []
                if isinstance(node, ast.Import):
                    names = [
                        item.asname or item.name.split(".")[0] for item in node.names
                    ]
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
                    if binding in bound and (not same_module_import):
                        module.unstable.add(binding)
                        if module.path in self.context.entries:
                            self.diagnostics.report(
                                "rebound-name-unresolved",
                                "Repeated binding requires runtime resolution: "
                                + binding,
                                module.path,
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
                            if module.path.endswith("/__init__.py")
                            else name.split(".")[:-1]
                        )
                        base = ".".join(
                            parent[: len(parent) - node.level + 1]
                            + ([base] if base else [])
                        )
                    for item in node.names:
                        if item.name == "*":
                            if module.path in self.context.entries:
                                self.diagnostics.report(
                                    "wildcard-import-unresolved",
                                    "Wildcard exports require explicit native assembly; no application module was imported.",
                                    module.path,
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
                    module.nodes[node.name] = node

    def reference(self, node, module_name, seen=()):
        if isinstance(node, ast.Name):
            if node.id in self.modules[module_name].unstable:
                return None
            value = self.modules[module_name].aliases.get(
                node.id, module_name + "." + node.id
            )
        elif isinstance(node, ast.Attribute):
            parent = self.reference(node.value, module_name, seen)
            return self.canonical(parent + "." + node.attr, seen) if parent else None
        else:
            return None
        return self.canonical(value, seen)

    def canonical(self, value, seen=()):
        if value is None or value in seen:
            return value
        for module_name in sorted(self.modules, key=len, reverse=True):
            if value.startswith(module_name + "."):
                tail = value[len(module_name) + 1 :]
                first, _, rest = tail.partition(".")
                if first in self.modules[module_name].unstable:
                    return None
                alias = self.modules[module_name].aliases.get(first)
                if alias:
                    return self.canonical(
                        alias + ("." + rest if rest else ""), (*seen, value)
                    )
                break
        return value

    def literal(self, node, module_name, seen=()):
        if node is None:
            return UNKNOWN
        try:
            return ast.literal_eval(node)
        except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
            pass
        ref = self.reference(node, module_name)
        if ref and ref not in seen:
            for owner in sorted(self.modules, key=len, reverse=True):
                if ref.startswith(owner + "."):
                    value = self.modules[owner].values.get(ref[len(owner) + 1 :])
                    if value is not None:
                        return self.literal(value, owner, (*seen, ref))
                    break
        return UNKNOWN

    def decorators(self, node, module_name):
        return [
            (self.reference(d.func if isinstance(d, ast.Call) else d, module_name), d)
            for d in node.decorator_list
        ]
