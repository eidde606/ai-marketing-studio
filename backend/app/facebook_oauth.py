"""Compatibility imports for the feature-owned Facebook provider adapter."""
from app.features.facebook.provider import (
    FACEBOOK_LOGIN_URL,
    FACEBOOK_SCOPES,
    GRAPH_API_URL,
    REDIRECT_URI,
    exchange_code_for_token,
    get_facebook_login_url,
    get_long_lived_user_token,
    get_managed_pages,
)

__all__ = [
    "FACEBOOK_LOGIN_URL",
    "FACEBOOK_SCOPES",
    "GRAPH_API_URL",
    "REDIRECT_URI",
    "exchange_code_for_token",
    "get_facebook_login_url",
    "get_long_lived_user_token",
    "get_managed_pages",
]
