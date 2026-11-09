"""Add draft soft delete.

Revision ID: c8e913a74b02
Revises: 5dec0375b6f0
"""
from alembic import op
import sqlalchemy as sa

revision = "c8e913a74b02"
down_revision = "5dec0375b6f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("drafts", "deleted_at")
