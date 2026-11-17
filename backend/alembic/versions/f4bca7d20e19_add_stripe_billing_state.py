"""Add Stripe customer, subscription, and webhook idempotency state.

Revision ID: f4bca7d20e19
Revises: b8c2f7419d60
"""
from alembic import op
import sqlalchemy as sa


revision = "f4bca7d20e19"
down_revision = "b8c2f7419d60"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "customer_entitlements",
        sa.Column("stripe_customer_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column("stripe_subscription_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column("stripe_price_id", sa.String(255), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column("stripe_event_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "customer_entitlements",
        sa.Column(
            "cancel_at_period_end", sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_unique_constraint(
        "uq_customer_entitlements_stripe_customer",
        "customer_entitlements",
        ["stripe_customer_id"],
    )
    op.create_unique_constraint(
        "uq_customer_entitlements_stripe_subscription",
        "customer_entitlements",
        ["stripe_subscription_id"],
    )
    op.create_table(
        "stripe_webhook_events",
        sa.Column("event_id", sa.String(255), primary_key=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade():
    op.drop_table("stripe_webhook_events")
    op.drop_constraint(
        "uq_customer_entitlements_stripe_subscription",
        "customer_entitlements",
        type_="unique",
    )
    op.drop_constraint(
        "uq_customer_entitlements_stripe_customer",
        "customer_entitlements",
        type_="unique",
    )
    op.drop_column("customer_entitlements", "cancel_at_period_end")
    op.drop_column("customer_entitlements", "current_period_end")
    op.drop_column("customer_entitlements", "current_period_start")
    op.drop_column("customer_entitlements", "stripe_price_id")
    op.drop_column("customer_entitlements", "stripe_event_created_at")
    op.drop_column("customer_entitlements", "stripe_subscription_id")
    op.drop_column("customer_entitlements", "stripe_customer_id")
