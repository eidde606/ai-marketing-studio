"""allow facebook page across businesses

Revision ID: 55b97904f477
Revises: 5ffd04272559
Create Date: 2026-10-25 23:03:48.871297

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "55b97904f477"
down_revision: Union[str, Sequence[str], None] = "5ffd04272559"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_social_accounts_platform_account",
        "social_accounts",
        type_="unique",
    )

    op.create_unique_constraint(
        "uq_social_accounts_business_platform_account",
        "social_accounts",
        ["business_id", "platform", "platform_account_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_social_accounts_business_platform_account",
        "social_accounts",
        type_="unique",
    )

    op.create_unique_constraint(
        "uq_social_accounts_platform_account",
        "social_accounts",
        ["platform", "platform_account_id"],
    )
