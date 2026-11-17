"""Persist Instagram publication state independently from other platforms.

Revision ID: e71c4a9d2f60
Revises: d23e4c8a9f10
"""
from alembic import op
import sqlalchemy as sa


revision = "e71c4a9d2f60"
down_revision = "d23e4c8a9f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "drafts",
        sa.Column("instagram_media_id", sa.String(), nullable=True),
    )
    op.add_column(
        "drafts",
        sa.Column("instagram_permalink", sa.String(), nullable=True),
    )
    op.add_column(
        "drafts",
        sa.Column(
            "instagram_publish_status",
            sa.String(),
            nullable=False,
            server_default="not_published",
        ),
    )
    op.add_column(
        "drafts",
        sa.Column(
            "instagram_published_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_drafts_instagram_publish_status",
        "drafts",
        "instagram_publish_status IN "
        "('not_published', 'publishing', 'published', 'failed', 'needs_review')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_drafts_instagram_publish_status",
        "drafts",
        type_="check",
    )
    op.drop_column("drafts", "instagram_published_at")
    op.drop_column("drafts", "instagram_publish_status")
    op.drop_column("drafts", "instagram_permalink")
    op.drop_column("drafts", "instagram_media_id")
