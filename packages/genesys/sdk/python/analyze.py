import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from definitions import NativeDefinitions
from diagnostics import Diagnostics
from package_context import load_package
from registration import emit_registration
from source_index import SourceIndex
from workers import plan_workers


def main(data):
    diagnostics = Diagnostics()
    context = load_package(data, diagnostics)
    if context is None:
        return {
            "definitions": [],
            "diagnostics": diagnostics.items,
            "workers": [],
            "artifacts": [],
        }
    sources = SourceIndex(context, diagnostics)
    definitions = NativeDefinitions(context, sources, diagnostics)
    registration = emit_registration(context, sources, definitions, diagnostics)
    workers = plan_workers(context, sources, registration.metadata_root, diagnostics)
    diagnostics.report(
        "sdk-version-evidence",
        "Registration APIs inspected at temporalio 1.36.1 and nexus-rpc 1.5.0. Authored dependency resolution and runtime compatibility require the native build; static analysis does not import the SDK.",
        context.manifest if context.manifest in context.sources else context.root,
        severity="info",
    )
    return {
        "definitions": definitions.records,
        "diagnostics": diagnostics.items,
        "workers": workers,
        "artifacts": registration.artifacts,
    }


if __name__ == "__main__":
    json.dump(main(json.load(sys.stdin)), sys.stdout, sort_keys=True)
