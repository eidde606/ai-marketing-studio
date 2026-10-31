"""add facebook page selection fields

Revision ID: 5ffd04272559
Revises: 0a44e98ee52d
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5ffd04272559"
down_revision: Union[str, Sequence[str], None] = "0a44e98ee52d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "facebook_oauth_states",
        sa.Column("encrypted_pages", sa.String(), nullable=True),
    )

    op.add_column(
        "facebook_oauth_states",
        sa.Column(
            "selection_token_hash",
            sa.String(length=64),
            nullable=True,
        ),
    )

    op.create_unique_constraint(
        "uq_facebook_oauth_selection_token",
        "facebook_oauth_states",
        ["selection_token_hash"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_facebook_oauth_selection_token",
        "facebook_oauth_states",
        type_="unique",
    )

    op.drop_column(
        "facebook_oauth_states",
        "selection_token_hash",
    )

    op.drop_column(
        "facebook_oauth_states",
        "encrypted_pages",
    )