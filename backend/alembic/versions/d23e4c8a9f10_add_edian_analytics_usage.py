"""Add Edian's tenant-scoped result cache and distinct usage metric.

Revision ID: d23e4c8a9f10
Revises: f3a8b61c2d90, f4bca7d20e19
"""
from alembic import op
import sqlalchemy as sa


revision = "d23e4c8a9f10"
down_revision = ("f3a8b61c2d90", "f4bca7d20e19")
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_usage_reservations") as batch:
        batch.drop_constraint(
            "ck_ai_usage_reservations_metric",
            type_="check",
        )
        batch.create_check_constraint(
            "ck_ai_usage_reservations_metric",
            "metric IN ('sofia_request', 'leo_generation', 'edian_analysis')",
        )

    op.create_table(
        "edian_analyses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "business_id",
            sa.String(36),
            sa.ForeignKey("businesses.id"),
            nullable=False,
        ),
        sa.Column("input_fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "business_id",
            "input_fingerprint",
            name="uq_edian_analyses_business_fingerprint",
        ),
        sa.CheckConstraint(
            "status IN ('processing', 'succeeded', 'failed')",
            name="ck_edian_analyses_status",
        ),
    )


def downgrade() -> None:
    op.drop_table("edian_analyses")
    with op.batch_alter_table("ai_usage_reservations") as batch:
        batch.drop_constraint(
            "ck_ai_usage_reservations_metric",
            type_="check",
        )
        batch.create_check_constraint(
            "ck_ai_usage_reservations_metric",
            "metric IN ('sofia_request', 'leo_generation')",
        )
