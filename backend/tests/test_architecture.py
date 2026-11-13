"""Static route-to-repository guardrail; never imports application modules."""
import ast
from importlib.util import resolve_name
from pathlib import Path

import pytest


APP_ROOT = Path(__file__).resolve().parents[1] / "app"

# Exact (source module, repository module) -> reason. No current violations.
# Remove an entry when its dependency is removed; stale entries fail the test.
ROUTE_REPOSITORY_EXCEPTIONS: dict[tuple[str, str], str] = {}


def _is_route(module: str) -> bool:
    return module == "app.main" or any(
        part == "routes" or part.endswith("_routes")
        for part in module.split(".")[1:]
    )


def _is_repository(module: str) -> bool:
    return module.startswith("app.") and any(
        part in {"repository", "repositories"} or part.endswith("_repository")
        for part in module.split(".")[1:]
    )


def _route_repository_imports(app_root: Path) -> set[tuple[str, str]]:
    edges = set()
    for path in sorted(app_root.rglob("*.py")):
        parts = list(path.relative_to(app_root.parent).with_suffix("").parts)
        is_package = parts[-1] == "__init__"
        if is_package:
            parts.pop()
        module = ".".join(parts)
        if not _is_route(module):
            continue
        package = module if is_package else module.rpartition(".")[0]
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ""
                if node.level:
                    base = resolve_name("." * node.level + base, package)
                # A repository base imports symbols; otherwise check imported
                # submodules, e.g. `from . import repository as repo`.
                targets = [base] if _is_repository(base) else [
                    f"{base}.{alias.name}" for alias in node.names
                ]
            else:
                continue
            edges.update((module, target) for target in targets if _is_repository(target))
    return edges


def _assert_route_boundary(app_root: Path, exceptions: dict[tuple[str, str], str]) -> None:
    actual = _route_repository_imports(app_root)
    unexpected = actual - exceptions.keys()
    stale = exceptions.keys() - actual
    assert all(reason.strip() for reason in exceptions.values()), "Exceptions need a reason"
    assert not unexpected and not stale, (
        "Route-to-repository imports must go through application services.\n"
        f"New violations: {sorted(unexpected)}\n"
        f"Stale exceptions (remove them): {sorted(stale)}"
    )


def test_backend_routes_do_not_import_repositories():
    _assert_route_boundary(APP_ROOT, ROUTE_REPOSITORY_EXCEPTIONS)


def _write_route(tmp_path: Path, source: str, relative_path: str = "features/new/routes.py") -> Path:
    app_root = tmp_path / "app"
    route = app_root / relative_path
    route.parent.mkdir(parents=True, exist_ok=True)
    route.write_text(source, encoding="utf-8")
    return app_root


@pytest.mark.parametrize("source", [
    "import app.features.new.repository",
    "import app.features.new.repository as repo",
    "from app.features.new import repository as repo",
    "from app.features.new.repository import get_business",
    "from app.features.new.repository import *",
    "from . import repository",
    "from .repository import get_business as get",
    "from ..new import repository",
    "def handler():\n    from . import repository",
    "if TYPE_CHECKING:\n    from . import repository",
])
def test_new_route_repository_import_fails(tmp_path, source):
    app_root = _write_route(tmp_path, source)
    assert _route_repository_imports(app_root) == {
        ("app.features.new.routes", "app.features.new.repository"),
    }
    with pytest.raises(AssertionError, match="New violations:"):
        _assert_route_boundary(app_root, {})


@pytest.mark.parametrize("source", [
    "from . import service",
    "from .service import start_connection",
    "from app.features.new import service as repository",
    "import app.features.new.service",
])
def test_route_service_import_is_allowed(tmp_path, source):
    _assert_route_boundary(_write_route(tmp_path, source), {})


@pytest.mark.parametrize("relative_path, source, expected_source, expected_target", [
    ("features/new/routes/__init__.py", "from .. import repository",
     "app.features.new.routes", "app.features.new.repository"),
    ("features/new/routes/accounts.py", "from ...other import repository",
     "app.features.new.routes.accounts", "app.features.other.repository"),
    ("features/new/account_routes.py", "from .repositories import accounts",
     "app.features.new.account_routes", "app.features.new.repositories"),
    ("facebook_auth_routes.py", "from .features.new import repository",
     "app.facebook_auth_routes", "app.features.new.repository"),
    ("main.py", "from app.features.new.account_repository import get_account",
     "app.main", "app.features.new.account_repository"),
])
def test_route_and_repository_module_conventions(
    tmp_path, relative_path, source, expected_source, expected_target,
):
    app_root = _write_route(tmp_path, source, relative_path)
    assert _route_repository_imports(app_root) == {(expected_source, expected_target)}


def test_exception_allows_only_its_exact_dependency(tmp_path):
    app_root = _write_route(tmp_path, "from . import repository")
    exceptions = {
        ("app.features.new.routes", "app.features.new.repository"): "Existing debt",
    }
    _assert_route_boundary(app_root, exceptions)
    _write_route(tmp_path, "from . import repository\nfrom ..other import repository")
    with pytest.raises(AssertionError, match="app.features.other.repository"):
        _assert_route_boundary(app_root, exceptions)
    _write_route(tmp_path, "from . import repository", "features/other/routes.py")
    with pytest.raises(AssertionError, match="app.features.other.routes"):
        _assert_route_boundary(app_root, exceptions)


def test_removed_dependency_requires_removing_exception(tmp_path):
    app_root = _write_route(tmp_path, "from . import service")
    with pytest.raises(AssertionError, match="Stale exceptions"):
        _assert_route_boundary(app_root, {
            ("app.features.new.routes", "app.features.new.repository"): "Existing debt",
        })
