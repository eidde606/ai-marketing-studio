from urllib.parse import urlsplit


ALLOWED_FRONTEND_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "https://nazbort-ai-marketing-studio.netlify.app",
    "https://nazbort-ai-studio.netlify.app",
    "https://studio.nazborttech.com",
)


def resolve_frontend_origin(origin: str | None, frontend_url: str) -> str:
    configured = urlsplit(frontend_url.rstrip("/"))
    if (
        configured.scheme not in ("http", "https")
        or not configured.netloc
        or configured.username
        or configured.password
        or configured.query
        or configured.fragment
        or (
            configured.scheme == "http"
            and configured.hostname not in ("localhost", "127.0.0.1")
        )
    ):
        raise ValueError("Invalid frontend URL configuration")

    configured_origin = f"{configured.scheme}://{configured.netloc}"
    if origin is None:
        return configured_origin

    requested = urlsplit(origin)
    if (
        requested.scheme not in ("http", "https")
        or not requested.netloc
        or requested.username
        or requested.password
        or requested.path
        or requested.query
        or requested.fragment
    ):
        raise ValueError("Frontend origin is not allowed")

    requested_origin = f"{requested.scheme}://{requested.netloc}"
    if (
        origin != requested_origin
        or (
            requested_origin != configured_origin
            and requested_origin not in ALLOWED_FRONTEND_ORIGINS
        )
    ):
        raise ValueError("Frontend origin is not allowed")
    return requested_origin
