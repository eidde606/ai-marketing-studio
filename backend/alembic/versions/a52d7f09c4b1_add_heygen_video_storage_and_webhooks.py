"""Track HeyGen completion storage and webhook deliveries.

Revision ID: a52d7f09c4b1
Revises: f3a8b61c2d90
"""
from alembic import op
import sqlalchemy as sa

revision = "a52d7f09c4b1"
down_revision = "f3a8b61c2d90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_heygen_generation_attempts_provider_video_id",
        "heygen_generation_attempts",
        ["provider_video_id"],
    )
    op.add_column(
        "heygen_generation_attempts",
        sa.Column(
            "storage_status",
            sa.String(20),
            nullable=False,
            server_default="PENDING",
        ),
    )
    op.add_column(
        "heygen_generation_attempts",
        sa.Column("storage_path", sa.String(), nullable=True),
    )
    op.add_column(
        "heygen_generation_attempts",
        sa.Column("completion_lease_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_heygen_generation_attempts_storage_status",
        "heygen_generation_attempts",
        "storage_status IN ('PENDING', 'PROCESSING', 'RETRY', 'STORED', 'FAILED')",
    )
    op.create_table(
        "heygen_webhook_deliveries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("deduplication_key", sa.String(64), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("provider_video_id", sa.String(), nullable=False),
        sa.Column("callback_id", sa.String(36), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "deduplication_key",
            name="uq_heygen_webhook_deliveries_deduplication_key",
        ),
    )
    op.create_index(
        "ix_heygen_webhook_deliveries_provider_video_id",
        "heygen_webhook_deliveries",
        ["provider_video_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_heygen_webhook_deliveries_provider_video_id",
        table_name="heygen_webhook_deliveries",
    )
    op.drop_table("heygen_webhook_deliveries")
    op.drop_constraint(
        "uq_heygen_generation_attempts_provider_video_id",
        "heygen_generation_attempts",
        type_="unique",
    )
    op.drop_constraint(
        "ck_heygen_generation_attempts_storage_status",
        "heygen_generation_attempts",
        type_="check",
    )
    op.drop_column("heygen_generation_attempts", "completion_lease_until")
    op.drop_column("heygen_generation_attempts", "storage_path")
    op.drop_column("heygen_generation_attempts", "storage_status")
