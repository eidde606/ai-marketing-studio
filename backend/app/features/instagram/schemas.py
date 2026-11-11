from typing import Literal

from pydantic import BaseModel, Field

InstagramStatus = Literal[
    "not_connected",
    "linked_not_api_authorized",
    "connected_and_authorized",
    "reauthorization_required",
    "permission_error",
    "discovery_error",
]


class InstagramConnectionResponse(BaseModel):
    status: InstagramStatus
    username: str | None = None
    facebook_page_id: str | None = None
    facebook_page_name: str | None = None
    granted_permissions: list[str] = Field(default_factory=list)
    missing_permissions: list[str] = Field(default_factory=list)
    message: str | None = None
