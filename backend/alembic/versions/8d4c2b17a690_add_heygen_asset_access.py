"""Add explicit tenant access records for HeyGen assets.

Revision ID: 8d4c2b17a690
Revises: c2a41d8e930f
"""
from alembic import op
import sqlalchemy as sa

revision = "8d4c2b17a690"
down_revision = "c2a41d8e930f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "heygen_asset_access",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("asset_type", sa.String(20), nullable=False),
        sa.Column("provider_asset_id", sa.String(255), nullable=False),
        sa.Column("access_scope", sa.String(30), nullable=False),
        sa.Column(
            "business_id",
            sa.String(36),
            sa.ForeignKey("businesses.id"),
            nullable=True,
        ),
        sa.Column(
            "assigned_by_user_id",
            sa.String(36),
            sa.ForeignKey("app_users.id"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint(
            "asset_type IN ('avatar', 'voice')",
            name="ck_heygen_asset_access_type",
        ),
        sa.CheckConstraint(
            "access_scope IN ('platform_stock', 'business_private')",
            name="ck_heygen_asset_access_scope",
        ),
        sa.CheckConstraint(
            "(access_scope = 'platform_stock' AND business_id IS NULL "
            "AND assigned_by_user_id IS NULL) OR "
            "(access_scope = 'business_private' AND business_id IS NOT NULL "
            "AND assigned_by_user_id IS NOT NULL)",
            name="ck_heygen_asset_access_business_scope",
        ),
        sa.UniqueConstraint(
            "asset_type",
            "provider_asset_id",
            name="uq_heygen_asset_access_provider_asset",
        ),
    )
    op.create_index(
        "ix_heygen_asset_access_business",
        "heygen_asset_access",
        ["business_id", "asset_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_heygen_asset_access_business", table_name="heygen_asset_access")
    op.drop_table("heygen_asset_access")
