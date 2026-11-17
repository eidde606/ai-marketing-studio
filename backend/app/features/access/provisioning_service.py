"""One-time, manifest-bound provisioning for an empty tenant identity schema."""
import os
from uuid import uuid4

from sqlalchemy.orm import Session

from app.errors import ApplicationError, ErrorKind
from app.features.access import repository
from app.features.access.principal import Principal
from app.features.access.service import resolve_principal
from app.models import BusinessMembership, User
from app.transactions import Transactions


def provision_initial_owner(
    db: Session,
    business_ids: list[str],
):
    """Provision only the configured allowlisted identity and explicit full manifest.

    This is an offline bootstrap operation, not an HTTP endpoint. It refuses to
    infer ownership or run when either identity table already contains records.
    Use a clean, dedicated session with application traffic stopped. The configured
    identity must have been verified by the operator before invoking this function.
    Repeats fail closed with CONFLICT; they never reconcile or expand ownership.
    """
    transactions = Transactions(db)
    try:
        allowed_user_id = os.getenv("ALLOWED_USER_ID", "").strip()
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if not allowed_user_id or not supabase_url:
            raise ApplicationError(ErrorKind.FORBIDDEN, "Application identity is not configured")
        if (
            not business_ids
            or any(not isinstance(value, str) or not value.strip() for value in business_ids)
            or len(set(business_ids)) != len(business_ids)
        ):
            raise ApplicationError(ErrorKind.INVALID_INPUT, "A unique business manifest is required")

        principal = Principal(
            issuer=f"{supabase_url}/auth/v1",
            subject=allowed_user_id,
        )
        existing_business_ids = repository.lock_all_businesses_for_initial_provisioning(db)
        if set(business_ids) != existing_business_ids:
            raise ApplicationError(
                ErrorKind.CONFLICT,
                "The approved business manifest does not match the existing businesses",
            )
        if repository.has_application_users(db) or repository.has_business_memberships(db):
            raise ApplicationError(
                ErrorKind.CONFLICT,
                "Initial provisioning requires empty identity and membership tables",
            )

        user = User(
            id=str(uuid4()),
            auth_issuer=principal.issuer,
            auth_subject=principal.subject,
            status="active",
        )
        memberships = [
            BusinessMembership(
                id=str(uuid4()),
                business_id=business_id,
                user_id=user.id,
                role="owner",
                status="active",
            )
            for business_id in business_ids
        ]
        repository.add_initial_user_and_owner_memberships(db, user, memberships)
        authenticated = resolve_principal(db, principal)
        transactions.commit()
        return authenticated
    except Exception:
        transactions.rollback()
        raise
