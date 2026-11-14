"""Add customer organization, entitlement, usage, and onboarding foundations.

Revision ID: b8c2f7419d60
Revises: 91f6a20d3b8e
"""
from alembic import op
import sqlalchemy as sa


revision = "b8c2f7419d60"
down_revision = "91f6a20d3b8e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "customer_organizations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("owner_user_id", name="uq_customer_organizations_owner"),
    )
    op.create_table(
        "customer_entitlements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("customer_organizations.id"), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("trial_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_provider_status", sa.String(40), nullable=True),
        sa.Column("limits", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", name="uq_customer_entitlements_organization"),
        sa.CheckConstraint(
            "status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'operator_granted')",
            name="ck_customer_entitlements_status",
        ),
        sa.CheckConstraint(
            "trial_started_at IS NULL OR trial_expires_at IS NULL OR trial_expires_at > trial_started_at",
            name="ck_customer_entitlements_trial_dates",
        ),
    )
    op.create_table(
        "ai_usage_reservations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("customer_organizations.id"), nullable=False),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("app_users.id"), nullable=False),
        sa.Column("metric", sa.String(32), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="reserved"),
        sa.Column("result_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "organization_id", "metric", "idempotency_key",
            name="uq_ai_usage_organization_metric_key",
        ),
        sa.CheckConstraint(
            "metric IN ('sofia_request', 'leo_generation')",
            name="ck_ai_usage_reservations_metric",
        ),
        sa.CheckConstraint(
            "status IN ('reserved', 'succeeded', 'failed', 'uncertain')",
            name="ck_ai_usage_reservations_status",
        ),
    )
    op.create_index(
        "ix_ai_usage_reservations_org_metric_status",
        "ai_usage_reservations", ["organization_id", "metric", "status"],
    )
    op.create_table(
        "onboarding_progress",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("app_users.id"), primary_key=True),
        sa.Column("business_id", sa.String(36), sa.ForeignKey("businesses.id"), nullable=True),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tutorial_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("business_id", name="uq_onboarding_progress_business_id"),
        sa.CheckConstraint("current_step BETWEEN 1 AND 6", name="ck_onboarding_progress_step"),
    )
    op.add_column(
        "businesses",
        sa.Column("customer_organization_id", sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        "fk_businesses_customer_organization_id_customer_organizations",
        "businesses", "customer_organizations",
        ["customer_organization_id"], ["id"],
    )
    op.create_index(
        "ix_businesses_customer_organization_id",
        "businesses", ["customer_organization_id"],
    )


def downgrade():
    op.drop_index("ix_businesses_customer_organization_id", table_name="businesses")
    op.drop_constraint(
        "fk_businesses_customer_organization_id_customer_organizations",
        "businesses", type_="foreignkey",
    )
    op.drop_column("businesses", "customer_organization_id")
    op.drop_table("onboarding_progress")
    op.drop_index("ix_ai_usage_reservations_org_metric_status", table_name="ai_usage_reservations")
    op.drop_table("ai_usage_reservations")
    op.drop_table("customer_entitlements")
    op.drop_table("customer_organizations")
