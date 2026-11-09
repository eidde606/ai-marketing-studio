"""Add campaigns and optional draft associations.

Revision ID: e7b2c6d901af
Revises: c8e913a74b02
"""
from alembic import op
import sqlalchemy as sa

revision = "e7b2c6d901af"
down_revision = "c8e913a74b02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("objective", sa.String(2000), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'active', 'paused', 'completed', 'archived')", name="ck_campaigns_status"),
        sa.CheckConstraint("end_date IS NULL OR start_date IS NULL OR end_date >= start_date", name="ck_campaigns_dates"),
    )
    op.create_index("ix_campaigns_business_id", "campaigns", ["business_id"])
    op.add_column("drafts", sa.Column("campaign_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_drafts_campaign_id", "drafts", "campaigns", ["campaign_id"], ["id"])
    op.create_index("ix_drafts_campaign_id", "drafts", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_drafts_campaign_id", table_name="drafts")
    op.drop_constraint("fk_drafts_campaign_id", "drafts", type_="foreignkey")
    op.drop_column("drafts", "campaign_id")
    op.drop_index("ix_campaigns_business_id", table_name="campaigns")
    op.drop_table("campaigns")
