"""Explicit, fail-closed policy. AI authorization is separate from future quotas."""
from enum import Enum


class Role(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class Permission(str, Enum):
    READ = "read"
    EDIT_CONTENT = "edit_content"
    MANAGE_CAMPAIGNS = "manage_campaigns"
    USE_SOFIA = "use_sofia"
    USE_LEO = "use_leo"
    GENERATE_MEDIA = "generate_media"
    UPLOAD_MEDIA = "upload_media"
    SUBMIT_FOR_APPROVAL = "submit_for_approval"
    APPROVE_CONTENT = "approve_content"
    PUBLISH = "publish"
    MANAGE_CONNECTIONS = "manage_connections"
    MANAGE_HEYGEN_ASSETS = "manage_heygen_assets"
    EDIT_BUSINESS = "edit_business"
    MANAGE_MEMBERS = "manage_members"
    MANAGE_ADMINS = "manage_admins"
    MANAGE_OWNERS = "manage_owners"
    ARCHIVE_BUSINESS = "archive_business"


_MEMBER = frozenset({
    Permission.READ, Permission.EDIT_CONTENT, Permission.MANAGE_CAMPAIGNS,
    Permission.USE_SOFIA, Permission.USE_LEO, Permission.GENERATE_MEDIA,
    Permission.UPLOAD_MEDIA, Permission.SUBMIT_FOR_APPROVAL,
})
_ADMIN = _MEMBER | frozenset({
    Permission.APPROVE_CONTENT, Permission.PUBLISH, Permission.MANAGE_CONNECTIONS,
    Permission.MANAGE_HEYGEN_ASSETS, Permission.EDIT_BUSINESS, Permission.MANAGE_MEMBERS,
})
_OWNER = _ADMIN | frozenset({
    Permission.MANAGE_ADMINS, Permission.MANAGE_OWNERS, Permission.ARCHIVE_BUSINESS,
})
_GRANTS = {Role.OWNER: _OWNER, Role.ADMIN: _ADMIN, Role.MEMBER: _MEMBER}


def allows(role: str, permission: Permission) -> bool:
    return isinstance(permission, Permission) and permission in _GRANTS.get(role, ())
