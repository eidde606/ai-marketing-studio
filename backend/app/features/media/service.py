"""Coordinates HeyGen asset listing and preserves the legacy list responses."""
from .heygen_provider import (
    get_available_avatar_looks,
    get_available_voices,
    list_avatar_looks,
    list_voices,
)


def avatar_looks(
    *,
    avatar_type: str | None,
    ownership: str,
    limit: int,
    token: str | None,
) -> dict:
    return list_avatar_looks(
        avatar_type=avatar_type,
        ownership=ownership,
        limit=limit,
        token=token,
    )


def voices(*, voice_type: str, limit: int, token: str | None) -> dict:
    return list_voices(voice_type=voice_type, limit=limit, token=token)


def legacy_avatar_looks() -> list:
    return get_available_avatar_looks()


def legacy_voices() -> list:
    return get_available_voices()
