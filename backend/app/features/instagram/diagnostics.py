import os
import re
from urllib.parse import parse_qs, urlsplit

import httpx
from sqlalchemy.exc import ArgumentError
from sqlalchemy.engine import make_url

from app.environment import is_development_environment
from app.features.instagram.provider import GRAPH_API_URL

_PERMISSION_NAME = re.compile(r"^[a-z][a-z0-9_]{0,79}$")
_TASK_NAME = re.compile(r"^[A-Z][A-Z_]{0,39}$")
_TOKEN_TYPES = {"USER", "PAGE", "SYSTEM_USER", "APP"}
_PERMISSION_STATUSES = {"granted", "declined", "expired"}


def enabled_for_local_development() -> bool:
    if os.getenv("INSTAGRAM_OAUTH_DIAGNOSTICS_ENABLED", "").strip().lower() != "true":
        return False
    if not is_development_environment():
        return False

    try:
        database_url = make_url(os.getenv("DATABASE_URL", ""))
    except (ArgumentError, TypeError, ValueError):
        return False
    return (
        database_url.drivername == "postgresql+psycopg"
        and database_url.host == "localhost"
        and database_url.port == 5432
        and database_url.database == "ai_marketing_studio_dev"
        and database_url.username == "ai_marketing_studio_dev"
        and bool(database_url.password)
    )


def requested_but_unsafe() -> bool:
    return (
        os.getenv("INSTAGRAM_OAUTH_DIAGNOSTICS_ENABLED", "").strip().lower()
        == "true"
        and not enabled_for_local_development()
    )


def _permission_name(value: object) -> str | None:
    if isinstance(value, str) and _PERMISSION_NAME.fullmatch(value):
        return value
    return None


def _permission_status(value: object) -> str:
    return value if isinstance(value, str) and value in _PERMISSION_STATUSES else "other"


def _page_id(value: object) -> str | None:
    return value if isinstance(value, str) and value.isdecimal() else None


def _task_names(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({
        task for task in value
        if isinstance(task, str) and _TASK_NAME.fullmatch(task)
    })


def _error_code(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    return code if isinstance(code, int) and not isinstance(code, bool) else None


async def collect_oauth_diagnostics(
    access_token: str,
    authorized_page_id: str,
) -> dict:
    app_id = os.getenv("FACEBOOK_APP_ID", "")
    app_secret = os.getenv("FACEBOOK_APP_SECRET", "")
    result = {
        "token_type": "unknown",
        "token_valid": None,
        "app_id_match": None,
        "debug_scopes": [],
        "permissions": [],
        "page_ids": [],
        "page_tasks": {},
        "page_result_count": 0,
        "authorized_page_id": _page_id(authorized_page_id),
        "authorized_page_match": False,
        "page_list_complete": False,
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        if not app_id or not app_secret:
            result["errors"].append({
                "endpoint": "debug_token",
                "category": "app_credentials_unavailable",
            })
        else:
            debug_payload = await _request_payload(
                client,
                "debug_token",
                params={"input_token": access_token},
                authorization=f"Bearer {app_id}|{app_secret}",
                errors=result["errors"],
            )
            data = debug_payload.get("data") if isinstance(debug_payload, dict) else None
            if isinstance(data, dict):
                token_type = data.get("type")
                if isinstance(token_type, str) and token_type in _TOKEN_TYPES:
                    result["token_type"] = token_type
                valid = data.get("is_valid")
                result["token_valid"] = valid if isinstance(valid, bool) else None
                response_app_id = data.get("app_id")
                result["app_id_match"] = (
                    response_app_id == app_id
                    if isinstance(response_app_id, str)
                    else None
                )
                scopes = data.get("scopes")
                if isinstance(scopes, list):
                    result["debug_scopes"] = sorted({
                        name for item in scopes
                        if (name := _permission_name(item)) is not None
                    })
                else:
                    result["errors"].append({
                        "endpoint": "debug_token",
                        "category": "scopes_missing",
                    })
            elif debug_payload is not None:
                result["errors"].append({
                    "endpoint": "debug_token",
                    "category": "data_missing",
                })

        permissions_payload = await _request_payload(
            client,
            "me/permissions",
            authorization=f"Bearer {access_token}",
            errors=result["errors"],
        )
        permissions_data = (
            permissions_payload.get("data")
            if isinstance(permissions_payload, dict)
            else None
        )
        if isinstance(permissions_data, list):
            entries = set()
            for item in permissions_data:
                if not isinstance(item, dict):
                    continue
                name = _permission_name(item.get("permission"))
                if name is not None:
                    entries.add((name, _permission_status(item.get("status"))))
            result["permissions"] = [
                {"name": name, "status": status}
                for name, status in sorted(entries)
            ]
        elif permissions_payload is not None:
            result["errors"].append({
                "endpoint": "me/permissions",
                "category": "data_missing",
            })

        await _collect_page_list(
            client,
            access_token,
            authorized_page_id,
            result,
        )

    return result


async def _request_payload(
    client: httpx.AsyncClient,
    endpoint: str,
    *,
    authorization: str,
    errors: list,
    params: dict | None = None,
) -> dict | None:
    try:
        response = await client.get(
            f"{GRAPH_API_URL}/{endpoint}",
            params=params,
            headers={"Authorization": authorization},
        )
    except httpx.TimeoutException:
        errors.append({"endpoint": endpoint, "category": "timeout"})
        return None
    except httpx.HTTPError:
        errors.append({"endpoint": endpoint, "category": "transport_error"})
        return None

    if response.is_error:
        try:
            error_code = _error_code(response.json())
        except (TypeError, ValueError):
            error_code = None
        error = {
            "endpoint": endpoint,
            "category": "http_error",
            "status": response.status_code,
        }
        if error_code is not None:
            error["code"] = error_code
        errors.append(error)
        return None

    try:
        payload = response.json()
    except (TypeError, ValueError):
        errors.append({"endpoint": endpoint, "category": "invalid_json"})
        return None
    if not isinstance(payload, dict):
        errors.append({"endpoint": endpoint, "category": "invalid_response"})
        return None
    return payload


async def _collect_page_list(
    client: httpx.AsyncClient,
    access_token: str,
    authorized_page_id: str,
    result: dict,
) -> None:
    after: str | None = None
    seen_cursors: set[str] = set()
    page_ids: list[str] = []
    page_tasks: dict[str, list[str]] = {}
    result_count = 0

    while True:
        params = {"fields": "id,name,tasks", "limit": 100}
        if after is not None:
            params["after"] = after
        payload = await _request_payload(
            client,
            "me/accounts",
            params=params,
            authorization=f"Bearer {access_token}",
            errors=result["errors"],
        )
        if payload is None:
            break
        data = payload.get("data")
        if not isinstance(data, list):
            result["errors"].append({
                "endpoint": "me/accounts",
                "category": "data_missing",
            })
            break

        result_count += len(data)
        for item in data:
            if not isinstance(item, dict):
                result["errors"].append({
                    "endpoint": "me/accounts",
                    "category": "invalid_page_record",
                })
                continue
            page_id = _page_id(item.get("id"))
            if page_id is None:
                result["errors"].append({
                    "endpoint": "me/accounts",
                    "category": "invalid_page_id",
                })
                continue
            page_ids.append(page_id)
            page_tasks[page_id] = _task_names(item.get("tasks"))

        paging = payload.get("paging")
        has_next = isinstance(paging, dict) and bool(paging.get("next"))
        if not has_next:
            result["page_list_complete"] = True
            break

        cursors = paging.get("cursors")
        cursor = cursors.get("after") if isinstance(cursors, dict) else None
        if not isinstance(cursor, str) or not cursor:
            next_url = paging.get("next")
            if isinstance(next_url, str):
                query = parse_qs(urlsplit(next_url).query)
                cursor_values = query.get("after")
                cursor = cursor_values[0] if cursor_values else None
        if not isinstance(cursor, str) or not cursor:
            result["errors"].append({
                "endpoint": "me/accounts",
                "category": "pagination_cursor_missing",
            })
            break
        if cursor in seen_cursors:
            result["errors"].append({
                "endpoint": "me/accounts",
                "category": "pagination_cursor_repeated",
            })
            break
        seen_cursors.add(cursor)
        after = cursor

    result["page_ids"] = sorted(set(page_ids))
    result["page_tasks"] = {
        page_id: tasks for page_id, tasks in sorted(page_tasks.items())
    }
    result["page_result_count"] = result_count
    result["authorized_page_match"] = (
        result["authorized_page_id"] is not None
        and result["authorized_page_id"] in result["page_ids"]
    )
