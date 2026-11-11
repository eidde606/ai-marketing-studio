"""add Instagram OAuth state and business connections

Revision ID: b6d23e8a41c0
Revises: a52d7f09c4b1
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6d23e8a41c0"
down_revision: Union[str, Sequence[str], None] = "a52d7f09c4b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "instagram_oauth_states",
        sa.Column("state_hash", sa.String(length=64), primary_key=True),
        sa.Column(
            "business_id", sa.String(length=36),
            sa.ForeignKey("businesses.id"), nullable=False,
        ),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("facebook_page_id", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_instagram_oauth_states_expires_at",
        "instagram_oauth_states",
        ["expires_at"],
    )
    op.create_table(
        "instagram_connections",
        sa.Column(
            "business_id", sa.String(length=36),
            sa.ForeignKey("businesses.id"), primary_key=True,
        ),
        sa.Column("instagram_account_id", sa.String(), nullable=True),
        sa.Column("username", sa.String(), nullable=True),
        sa.Column("facebook_page_id", sa.String(), nullable=True),
        sa.Column("encrypted_access_token", sa.String(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("granted_permissions", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('connected_and_authorized', 'linked_not_api_authorized', "
            "'reauthorization_required', 'permission_error', 'discovery_error', "
            "'not_connected')",
            name="ck_instagram_connections_status",
        ),
    )


def downgrade() -> None:
    op.drop_table("instagram_connections")
    op.drop_index(
        "ix_instagram_oauth_states_expires_at",
        table_name="instagram_oauth_states",
    )
    op.drop_table("instagram_oauth_states")
