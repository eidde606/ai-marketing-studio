"""Explicit fixture ownership only; never installed as an ORM event or production hook."""
from sqlalchemy import select
from app.auth import SUPABASE_ISSUER
from app.features.access.principal import AuthenticatedPrincipal
from app.models import BusinessMembership, User


def grant_test_owner(db, business_ids=(), *, subject="test-authorized-user"):
    user = db.scalar(select(User).where(User.auth_issuer == SUPABASE_ISSUER, User.auth_subject == subject))
    if user is None:
        user = User(auth_issuer=SUPABASE_ISSUER, auth_subject=subject)
        db.add(user)
        db.flush()
    for business_id in business_ids:
        existing = db.scalar(select(BusinessMembership).where(BusinessMembership.user_id == user.id,
                                                              BusinessMembership.business_id == business_id))
        if existing is None:
            db.add(BusinessMembership(business_id=business_id, user_id=user.id, role="owner", status="active"))
    db.flush()
    return AuthenticatedPrincipal(SUPABASE_ISSUER, subject, user.id)
