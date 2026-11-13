"""Add application identities and memberships without assigning ownership.

Revision ID: c2a41d8e930f
Revises: b6d23e8a41c0
"""
from alembic import op
import sqlalchemy as sa

revision = "c2a41d8e930f"
down_revision = "b6d23e8a41c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("auth_issuer", sa.String(512), nullable=False),
        sa.Column("auth_subject", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("auth_issuer", "auth_subject", name="uq_app_users_identity"),
        sa.CheckConstraint("status IN ('active', 'disabled')", name="ck_app_users_status"),
        sa.CheckConstraint("length(trim(auth_issuer)) > 0 AND length(trim(auth_subject)) > 0", name="ck_app_users_identity_not_empty"),
    )
    op.create_table(
        "business_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("business_id", "user_id", name="uq_business_memberships_business_user"),
        sa.CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_business_memberships_role"),
        sa.CheckConstraint("status IN ('active', 'suspended', 'revoked')", name="ck_business_memberships_status"),
    )
    op.create_index("ix_business_memberships_user_status", "business_memberships", ["user_id", "status"])


def downgrade() -> None:
    # Explicit operator action only: this drops membership/identity data.
    op.drop_index("ix_business_memberships_user_status", table_name="business_memberships")
    op.drop_table("business_memberships")
    op.drop_table("app_users")
