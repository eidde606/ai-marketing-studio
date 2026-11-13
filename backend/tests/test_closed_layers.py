"""Incremental persistence and HTTP boundary checks for feature modules."""
import ast
from pathlib import Path

import pytest


APP_ROOT = Path(__file__).resolve().parents[1] / "app"
DB_OPERATIONS = {"get", "scalar", "scalars", "execute", "query", "add", "delete",
                 "flush", "commit", "rollback", "refresh"}


def violations(source: str, module: str) -> set[tuple[str, str, str]]:
    """Report exact module/function/operation edges, including nested functions."""
    tree = ast.parse(source)
    result = set()
    is_repository = module.endswith(".repository") or module.startswith("app.persistence.")
    is_service = module.endswith("service")
    is_route = module.endswith("routes") or module in {"app.main", "app.auth"}
    for function in (n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
        for node in ast.walk(function):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                if node.func.value.id == "db" and node.func.attr in DB_OPERATIONS:
                    if is_service or is_route or (is_repository and node.func.attr in {"commit", "rollback"}):
                        result.add((module, function.name, "db." + node.func.attr))
            if is_service and isinstance(node.func, ast.Name) and node.func.id == "HTTPException":
                result.add((module, function.name, "HTTPException"))
    return result


# No known feature-layer violations remain.
EXCEPTIONS = set()


def test_feature_layers():
    actual = set()
    for path in [*(APP_ROOT / "features").rglob("*.py"),
                 *(APP_ROOT / "persistence").rglob("*.py"), APP_ROOT / "auth.py"]:
        module = ".".join(path.relative_to(APP_ROOT.parent).with_suffix("").parts)
        actual.update(violations(path.read_text(), module))
    assert actual == EXCEPTIONS, (
        f"New layer violations: {sorted(actual - EXCEPTIONS)}\n"
        f"Remove resolved exceptions: {sorted(EXCEPTIONS - actual)}"
    )


@pytest.mark.parametrize("module, source, expected", [
    ("app.features.demo.service", "def run(db):\n    return db.get(Model, key)", "db.get"),
    ("app.features.demo.routes", "def run(db):\n    db.commit()", "db.commit"),
    ("app.features.demo.service", "def run():\n    raise HTTPException(404)", "HTTPException"),
    ("app.features.demo.repository", "def save(db):\n    db.commit()", "db.commit"),
    ("app.auth", "def resolve(db):\n    return db.get(User, key)", "db.get"),
])
def test_detects_closed_layer_violation(module, source, expected):
    assert {edge[2] for edge in violations(source, module)} == {expected}


def test_service_delegation_and_repository_queries_are_allowed():
    assert not violations("def run(db):\n    return repository.get_item(db, key)", "app.features.demo.service")
    assert not violations("def get_item(db):\n    return db.get(Model, key)", "app.features.demo.repository")
