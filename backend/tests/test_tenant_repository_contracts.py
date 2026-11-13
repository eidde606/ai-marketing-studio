"""Freeze legacy service/repository edges until individually authorized migration."""
import ast
from collections import Counter
from importlib.util import resolve_name
import json
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
MANIFEST = Path(__file__).with_name("legacy_repository_calls.json")


def legacy_calls():
    calls = Counter()
    for path in sorted((APP_ROOT / "features").glob("*/*service.py")):
        module = ".".join(path.relative_to(APP_ROOT.parent).with_suffix("").parts)
        package = module.rpartition(".")[0]
        tree = ast.parse(path.read_text())
        aliases = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                base = resolve_name("." * node.level + (node.module or ""), package) if node.level else node.module
                for alias in node.names:
                    aliases[alias.asname or alias.name] = f"{base}.{alias.name}"
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    aliases[alias.asname or alias.name.split(".")[0]] = alias.name if alias.asname else alias.name.split(".")[0]
        for function in (n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
            for call in (n for n in ast.walk(function) if isinstance(n, ast.Call)):
                name = ast.unparse(call.func)
                root, dot, suffix = name.partition(".")
                target = aliases.get(root, root) + (dot + suffix if dot else "")
                if ".repository." in target and not target.endswith("_scoped"):
                    calls[f"{module}:{function.name} -> {target}"] += 1
    return dict(sorted(calls.items()))


def test_legacy_repository_call_inventory_does_not_grow():
    # Exact function/callee/count, not a blanket exemption for an entire module.
    # Remove entries as callers migrate. New edges require a deliberate review.
    assert legacy_calls() == json.loads(MANIFEST.read_text())


def test_every_scoped_api_requires_explicit_context():
    for path in (APP_ROOT / "features").glob("*/repository.py"):
        for node in ast.parse(path.read_text()).body:
            if isinstance(node, ast.FunctionDef) and node.name.endswith("_scoped"):
                args = node.args.args
                assert [a.arg for a in args[:2]] == ["db", "context"], (path, node.name)
                assert ast.unparse(args[1].annotation) == "TenantAccess", (path, node.name)
                assert len(args) - len(node.args.defaults) >= 2, (path, node.name)


def test_services_cannot_import_persistence_helpers():
    for path in (APP_ROOT / "features").glob("*/*service.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("app.persistence"), path
            elif isinstance(node, ast.Import):
                assert all(not a.name.startswith("app.persistence") for a in node.names), path
