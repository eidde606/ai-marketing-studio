"""Add independent language preferences without rewriting existing content.

Revision ID: 91f6a20d3b8e
Revises: 8d4c2b17a690
"""
from alembic import op
import sqlalchemy as sa

revision = "91f6a20d3b8e"
down_revision = "8d4c2b17a690"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("app_users.id"), primary_key=True),
        sa.Column("interface_language", sa.String(2), nullable=False, server_default="en"),
        sa.Column("conversation_language", sa.String(2), nullable=False, server_default="en"),
        sa.CheckConstraint("interface_language IN ('en', 'es')", name="ck_user_preferences_interface"),
        sa.CheckConstraint("conversation_language IN ('en', 'es')", name="ck_user_preferences_conversation"),
    )
    op.create_table(
        "business_preferences",
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), primary_key=True),
        sa.Column("marketing_content_language", sa.String(2), nullable=False, server_default="en"),
        sa.CheckConstraint("marketing_content_language IN ('en', 'es')", name="ck_business_preferences_content"),
    )
    # Unknown historical languages remain unknown; no historical text is changed.
    op.add_column("drafts", sa.Column("marketing_content_language", sa.String(2), nullable=True))
    op.add_column("conversations", sa.Column("language", sa.String(2), nullable=True))


def downgrade():
    op.drop_column("conversations", "language")
    op.drop_column("drafts", "marketing_content_language")
    op.drop_table("business_preferences")
    op.drop_table("user_preferences")
