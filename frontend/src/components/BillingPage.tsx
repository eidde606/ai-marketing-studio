import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  RefreshCw,
} from "lucide-react";
import type { Translate } from "../app/localization";
import { useLocalization } from "../app/useLocalization";
import {
  createBillingCheckout,
  createBillingPortal,
  getBillingOverview,
  type BillingOverview,
} from "../services/billingApi";

type Props = {
  businessId: string;
  membershipRole: "owner" | "admin" | "member" | null;
};

const statusKey: Record<BillingOverview["status"], Parameters<Translate>[0]> = {
  trialing: "billing.status.trialing",
  active: "billing.status.active",
  past_due: "billing.status.past_due",
  canceled: "billing.status.canceled",
  expired: "billing.status.expired",
  operator_granted: "billing.status.operator",
  unavailable: "billing.status.unavailable",
};

const usageKeys: ReadonlyArray<readonly [string, Parameters<Translate>[0]]> = [
  ["businesses", "billing.usage.businesses"],
  ["leo_generations", "billing.usage.leo"],
  ["sofia_requests", "billing.usage.sofia"],
  ["edian_analyses", "billing.usage.edian"],
  ["campaigns", "billing.usage.campaigns"],
  ["heygen_generations", "billing.usage.heygen"],
] as const;

export default function BillingPage({ businessId, membershipRole }: Props) {
  const { t, locale } = useLocalization();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [action, setAction] = useState<"checkout" | "portal" | null>(null);
  const [actionError, setActionError] = useState(false);
  const [reload, setReload] = useState(0);
  const [billingReturn] = useState(
    () => new URLSearchParams(window.location.search).get("billing"),
  );
  const checkoutReturned = billingReturn === "success";
  const portalReturned = billingReturn === "returned";
  const canManageRole =
    membershipRole === "owner" || membershipRole === "admin";

  useEffect(() => {
    let active = true;
    getBillingOverview(businessId)
      .then((result) => {
        if (active) {
          setOverview(result);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [businessId, reload]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("billing")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("billing");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  async function beginSession(kind: "checkout" | "portal") {
    if (action) return;
    setAction(kind);
    setActionError(false);
    try {
      const result =
        kind === "checkout"
          ? await createBillingCheckout(businessId)
          : await createBillingPortal(businessId);
      const url = new URL(result.url);
      const expectedHost =
        kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com";
      if (url.protocol !== "https:" || url.hostname !== expectedHost) {
        throw new Error("Invalid Stripe URL");
      }
      window.location.assign(url.toString());
    } catch {
      setActionError(true);
      setAction(null);
    }
  }

  if (!businessId) {
    return (
      <section className="panel billing-empty">
        <CreditCard aria-hidden="true" />
        <h2>{t("billing.title")}</h2>
        <p>{t("billing.noBusiness")}</p>
      </section>
    );
  }
  if (!overview && !loadError) {
    return (
      <p className="billing-loading" role="status">
        {t("billing.loading")}
      </p>
    );
  }
  if (loadError || !overview) {
    return (
      <section className="panel billing-error" role="alert">
        <h2>{t("billing.loadError")}</h2>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw size={17} aria-hidden="true" />
          {t("common.retry")}
        </button>
      </section>
    );
  }

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale === "es" ? "es" : "en-US", {
          dateStyle: "long",
        }).format(new Date(value))
      : t("billing.notAvailable");
  const trialing = overview.status === "trialing";
  const active = overview.status === "active";
  const needsPayment = overview.status === "past_due";
  const statusTone = active
    ? "is-positive"
    : trialing
      ? "is-trial"
      : "is-warning";
  const manageAllowed = canManageRole && overview.can_manage;

  return (
    <main className="billing-page">
      <header className="page-intro billing-intro">
        <div>
          <span className="eyebrow">{t("billing.eyebrow")}</span>
          <h2>{t("billing.title")}</h2>
          <p>{t("billing.description")}</p>
        </div>
        <div className={`billing-status ${statusTone}`} role="status">
          <span className="billing-status__dot" aria-hidden="true" />
          {t(statusKey[overview.status])}
        </div>
      </header>

      {checkoutReturned && (
        <section className="billing-notice" role="status">
          <CheckCircle2 size={19} aria-hidden="true" />
          <p>{t("billing.checkoutReturn")}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            {t("common.refresh")}
          </button>
        </section>
      )}
      {portalReturned && (
        <section className="billing-notice" role="status">
          <CheckCircle2 size={19} aria-hidden="true" />
          <p>{t("billing.portalReturn")}</p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            {t("common.refresh")}
          </button>
        </section>
      )}
      {needsPayment && (
        <section className="billing-notice is-warning" role="alert">
          <p>{t("billing.paymentFailed")}</p>
        </section>
      )}
      {overview.cancel_at_period_end && (
        <section className="billing-notice is-warning" role="status">
          <p>
            {t("billing.cancelScheduled", {
              date: formatDate(overview.current_period_end),
            })}
          </p>
        </section>
      )}
      {actionError && (
        <p className="billing-action-error" role="alert">
          {t("billing.actionError")}
        </p>
      )}

      <div className="billing-grid">
        <section className="panel billing-summary">
          <div className="billing-card-heading">
            <span className="billing-icon">
              <CreditCard size={21} aria-hidden="true" />
            </span>
            <div>
              <h3>{t("billing.accountTitle")}</h3>
              <p>{t("billing.accountHelp")}</p>
            </div>
          </div>
          <dl className="billing-details">
            <div>
              <dt>{t("billing.subscriptionStatus")}</dt>
              <dd>{t(statusKey[overview.status])}</dd>
            </div>
            {trialing && (
              <>
                <div>
                  <dt>{t("billing.daysRemaining")}</dt>
                  <dd>
                    {t("billing.days", {
                      count: overview.days_remaining ?? 0,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{t("billing.trialEnds")}</dt>
                  <dd>{formatDate(overview.trial_expires_at)}</dd>
                </div>
              </>
            )}
            {active && overview.current_period_end && (
              <div>
                <dt>{t("billing.nextRenewal")}</dt>
                <dd>{formatDate(overview.current_period_end)}</dd>
              </div>
            )}
          </dl>
          {trialing && (
            <p className="billing-footnote">{t("billing.noCardTrial")}</p>
          )}
        </section>

        <section className="billing-plan-card">
          <span className="eyebrow">{t("billing.upgradeEyebrow")}</span>
          <h3>{overview.plan_name}</h3>
          <p className="billing-price">
            {overview.checkout_available
              ? (overview.price_display ?? t("billing.priceInCheckout"))
              : t("billing.comingSoon")}
          </p>
          <p>{t("billing.planDescription")}</p>
          {overview.checkout_available && manageAllowed && (
            <aside className="billing-refund-disclosure" role="note">
              <p>{t("billing.noRefundCheckout")}</p>
              <a href="/subscriptions">
                {t("billing.subscriptionPolicy")}
              </a>
            </aside>
          )}
          {overview.usage && (
            <ul className="billing-plan-limits">
              {usageKeys.map(([key, label]) => {
                const usage = overview.usage?.[key];
                if (!usage) return null;
                return (
                  <li key={key}>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {t(label)}: {usage.limit}
                  </li>
                );
              })}
            </ul>
          )}
          {active || overview.portal_available ? (
            <button
              type="button"
              className="primary-button billing-action"
              disabled={
                !overview.portal_available || !manageAllowed || !!action
              }
              onClick={() => void beginSession("portal")}
            >
              {action === "portal"
                ? t("billing.openingPortal")
                : t("billing.manageSubscription")}
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="primary-button billing-action"
              disabled={
                !overview.checkout_available || !manageAllowed || !!action
              }
              onClick={() => void beginSession("checkout")}
            >
              {action === "checkout"
                ? t("billing.openingCheckout")
                : t("billing.upgrade")}
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          )}
          {!manageAllowed && (
            <p className="billing-footnote">{t("billing.adminOnly")}</p>
          )}
          {overview.portal_available && manageAllowed && (
            <p className="billing-footnote">
              {t("billing.portalCancellationNotice")}
            </p>
          )}
          {manageAllowed &&
            !overview.checkout_available &&
            !overview.portal_available &&
            overview.status !== "operator_granted" && (
              <p className="billing-footnote">{t("billing.notConfigured")}</p>
            )}
          {overview.status === "operator_granted" && (
            <p className="billing-footnote">{t("billing.operatorPlan")}</p>
          )}
        </section>
      </div>

      {overview.usage && (
        <section className="panel billing-usage">
          <div className="billing-section-heading">
            <h3>{t("billing.usageTitle")}</h3>
            <p>{t(active ? "billing.monthlyUsage" : "billing.trialUsage")}</p>
          </div>
          <div className="billing-usage-grid">
            {usageKeys.map(([key, label]) => {
              const usage = overview.usage?.[key];
              if (!usage) return null;
              const percent =
                usage.limit > 0
                  ? Math.min(100, Math.round((usage.used / usage.limit) * 100))
                  : 0;
              return (
                <article className="billing-usage-item" key={key}>
                  <div>
                    <span>{t(label)}</span>
                    <strong>
                      {usage.used} / {usage.limit}
                    </strong>
                  </div>
                  <div
                    className="billing-usage-bar"
                    role="progressbar"
                    aria-label={t(label)}
                    aria-valuemin={0}
                    aria-valuemax={usage.limit}
                    aria-valuenow={usage.used}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
