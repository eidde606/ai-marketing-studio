"""Persist idempotent HeyGen generation attempts.

Revision ID: f3a8b61c2d90
Revises: e7b2c6d901af
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a8b61c2d90"
down_revision = "e7b2c6d901af"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "heygen_generation_attempts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column(
            "business_id",
            sa.String(36),
            sa.ForeignKey("businesses.id"),
            nullable=False,
        ),
        sa.Column(
            "draft_id",
            sa.String(36),
            sa.ForeignKey("drafts.id"),
            nullable=False,
        ),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(36), nullable=False),
        sa.Column("avatar_id", sa.String(), nullable=False),
        sa.Column("voice_id", sa.String(), nullable=False),
        sa.Column("script", sa.Text(), nullable=False),
        sa.Column("aspect_ratio", sa.String(10), nullable=False),
        sa.Column("resolution", sa.String(20), nullable=False),
        sa.Column("provider_video_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("first_submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submission_lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('SUBMITTING', 'UNKNOWN', 'PROCESSING', 'COMPLETED', 'FAILED')",
            name="ck_heygen_generation_attempts_status",
        ),
        sa.UniqueConstraint(
            "idempotency_key",
            name="uq_heygen_generation_attempts_idempotency_key",
        ),
    )
    op.create_index(
        "ix_heygen_generation_attempts_user_id",
        "heygen_generation_attempts",
        ["user_id"],
    )
    op.create_index(
        "ix_heygen_generation_attempts_business_id",
        "heygen_generation_attempts",
        ["business_id"],
    )
    op.create_index(
        "ix_heygen_generation_attempts_draft_id",
        "heygen_generation_attempts",
        ["draft_id"],
    )
    op.create_index(
        "uq_heygen_generation_attempts_active_draft",
        "heygen_generation_attempts",
        ["draft_id"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('SUBMITTING', 'UNKNOWN', 'PROCESSING')"
        ),
        sqlite_where=sa.text(
            "status IN ('SUBMITTING', 'UNKNOWN', 'PROCESSING')"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_heygen_generation_attempts_active_draft",
        table_name="heygen_generation_attempts",
    )
    op.drop_index(
        "ix_heygen_generation_attempts_draft_id",
        table_name="heygen_generation_attempts",
    )
    op.drop_index(
        "ix_heygen_generation_attempts_business_id",
        table_name="heygen_generation_attempts",
    )
    op.drop_index(
        "ix_heygen_generation_attempts_user_id",
        table_name="heygen_generation_attempts",
    )
    op.drop_table("heygen_generation_attempts")
