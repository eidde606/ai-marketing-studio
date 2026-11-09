"""add tiktok publishing account to drafts

Revision ID: 5dec0375b6f0
Revises: 050597245733
Create Date: 2026-11-08 13:31:30.457347

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5dec0375b6f0'
down_revision: Union[str, Sequence[str], None] = '050597245733'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "drafts",
        sa.Column("tiktok_account_id", sa.String(length=36), nullable=True),
    )

    op.create_foreign_key(
        "fk_drafts_tiktok_account_id",
        "drafts",
        "social_accounts",
        ["tiktok_account_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_drafts_tiktok_account_id",
        "drafts",
        type_="foreignkey",
    )

    op.drop_column("drafts", "tiktok_account_id")
