"""Freeze legacy service/repository edges until individually authorized migration."""
import ast
from collections import Counter
from importlib.util import resolve_name
import json
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
MANIFEST = Path(__file__).with_name("legacy_repository_calls.json")

# OAuth callbacks must discover a state row's business and initiating identity
# before they can construct an authorized TenantAccess. These metadata-only
# bootstrap lookups are followed by permission checks and tenant-scoped state
# consumption; they are not tenant resource reads.
OAUTH_BOOTSTRAP_LOOKUPS = {
    "app.features.facebook.service:complete_callback -> app.features.facebook.repository.oauth_state_identity": 1,
    "app.features.facebook.service:handoff_pages -> app.features.facebook.repository.pending_selection_business": 1,
    "app.features.facebook.service:select_page -> app.features.facebook.repository.pending_selection_business": 1,
    "app.features.instagram.service:consume_callback_state -> app.features.instagram.repository.oauth_state_identity": 1,
    "app.features.tiktok.service:complete_authorization -> app.features.tiktok.repository.oauth_state_identity": 1,
}

TRUSTED_MEDIA_LOOKUPS = {
    # These are exact, metadata-only bootstrap operations: platform stock is
    # explicitly shared, and webhook scope is derived from persisted records.
    "app.features.media.asset_access_service:list_accessible_asset_ids -> app.features.media.repository.list_platform_stock_heygen_asset_ids": 1,
    "app.features.media.generation_service:_reconcile_webhook_delivery -> app.features.media.repository.trusted_webhook_context_for_delivery": 1,
}

INITIAL_PROVISIONING_LOOKUPS = {
    # This offline bootstrap is allowlist-bound, manifest-checked, and refuses
    # to run unless identity and membership tables are empty.
    "app.features.access.provisioning_service:provision_initial_owner -> app.features.access.repository.add_initial_user_and_owner_memberships": 1,
    "app.features.access.provisioning_service:provision_initial_owner -> app.features.access.repository.has_application_users": 1,
    "app.features.access.provisioning_service:provision_initial_owner -> app.features.access.repository.has_business_memberships": 1,
    "app.features.access.provisioning_service:provision_initial_owner -> app.features.access.repository.lock_all_businesses_for_initial_provisioning": 1,
}


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
    actual = legacy_calls()
    for call, count in (
        OAUTH_BOOTSTRAP_LOOKUPS
        | TRUSTED_MEDIA_LOOKUPS
        | INITIAL_PROVISIONING_LOOKUPS
    ).items():
        assert actual.pop(call, None) == count
    assert actual == json.loads(MANIFEST.read_text())


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


def test_unscoped_draft_helpers_are_reserved_for_deferred_media():
    allowed = {
        ("features/drafts/service.py", "require_pending_draft", "require_draft"),
    }
    actual = set()
    for path in (APP_ROOT / "features").rglob("*.py"):
        for function in ast.parse(path.read_text()).body:
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for call in (n for n in ast.walk(function) if isinstance(n, ast.Call)):
                name = (call.func.attr if isinstance(call.func, ast.Attribute)
                        else call.func.id if isinstance(call.func, ast.Name) else None)
                if name in {"require_draft", "require_pending_draft"}:
                    actual.add((str(path.relative_to(APP_ROOT)), function.name, name))
    assert actual == allowed
