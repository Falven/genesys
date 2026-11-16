import configparser
import posixpath
import tomllib
from dataclasses import dataclass

from diagnostics import Diagnostics


@dataclass
class PackageContext:
    package: dict
    project_root: str
    root: str
    prefix: str
    sources: dict[str, str]
    nested_packages: set[str]
    entries: dict[str, dict]
    manifest: str
    config: dict
    tool: dict
    roots: list[str]
    cfg_path: str
    setup_cfg: configparser.ConfigParser


def load_package(data: dict, diagnostics: Diagnostics) -> PackageContext | None:
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
    manifest = prefix + "pyproject.toml"
    config = {}
    if manifest in sources:
        try:
            config = tomllib.loads(sources[manifest])
        except tomllib.TOMLDecodeError as error:
            diagnostics.report(
                "invalid-package", str(error), manifest, severity="error"
            )
    tool = config.get("tool", {})
    package_dirs = tool.get("setuptools", {}).get("package-dir", {})
    roots = []
    if package_dirs:
        if set(package_dirs) == {""} and isinstance(package_dirs[""], str):
            roots = [posixpath.normpath(prefix + package_dirs[""])]
        else:
            diagnostics.report(
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
                    diagnostics.report(
                        "package-layout-unresolved",
                        "Nonuniform setup.cfg package_dir requires explicit native assembly.",
                        cfg_path,
                    )
        except configparser.Error as error:
            diagnostics.report(
                "invalid-package", str(error), cfg_path, severity="error"
            )
    if not roots:
        roots = [
            prefix + "src"
            if any(p.startswith(prefix + "src/") and p.endswith(".py") for p in sources)
            else root
        ]
    roots = sorted(set(roots), key=lambda value: (-len(value), value))
    for source_root in roots:
        if source_root == ".." or source_root.startswith(("../", "/")):
            diagnostics.report(
                "package-layout-unresolved",
                "Python source root must be inside the isolated project.",
                manifest,
                severity="error",
            )
            return None
    return PackageContext(
        package,
        project_root,
        root,
        prefix,
        sources,
        nested_packages,
        entries,
        manifest,
        config,
        tool,
        roots,
        cfg_path,
        setup_cfg,
    )
