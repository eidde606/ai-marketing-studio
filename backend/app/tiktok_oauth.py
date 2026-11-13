"""Compatibility imports for the feature-owned TikTok provider adapter."""
from app.features.tiktok.provider import (
    SCOPES,
    TIKTOK_AUTHORIZE_URL,
    TIKTOK_TOKEN_URL,
    exchange_code_for_token,
    get_tiktok_login_url,
    get_tiktok_user,
    refresh_tiktok_token,
)

__all__ = [
    "SCOPES",
    "TIKTOK_AUTHORIZE_URL",
    "TIKTOK_TOKEN_URL",
    "exchange_code_for_token",
    "get_tiktok_login_url",
    "get_tiktok_user",
    "refresh_tiktok_token",
]
