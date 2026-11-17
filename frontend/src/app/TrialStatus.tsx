import { useEffect, useState } from "react";
import {
  getBusinessEntitlement,
  type BusinessEntitlement,
} from "../services/onboardingApi";
import { useLocalization } from "./useLocalization";
import { ProductNotice } from "./ProductStatus";

export default function TrialStatus({ businessId }: { businessId: string }) {
  const { t } = useLocalization();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    businessId: string;
    reload: number;
    result: BusinessEntitlement | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    if (!businessId)
      return () => {
        active = false;
      };
    getBusinessEntitlement(businessId)
      .then((result) => {
        if (active) setState({ businessId, reload, result, error: false });
      })
      .catch(() => {
        if (active) setState({ businessId, reload, result: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [businessId, reload]);

  if (!businessId) return null;
  const current =
    state?.businessId === businessId && state.reload === reload ? state : null;
  if (!current) return <p role="status">{t("trial.loading")}</p>;
  if (current.error || !current.result) {
    return (
      <div role="alert">
        <p>{t("trial.loadError")}</p>
        <button type="button" onClick={() => setReload((value) => value + 1)}>
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const entitlement = current.result;
  if (entitlement.status === "operator_granted") {
    return (
      <ProductNotice
        title={t("trial.operatorAccess")}
        description={t("trial.noTrial")}
      />
    );
  }

  if (entitlement.status !== "trialing" && entitlement.status !== "expired") {
    const statusDescriptions = {
      active: "trial.status.active",
      past_due: "trial.status.past_due",
      canceled: "trial.status.canceled",
      unavailable: "trial.status.unavailable",
      expired: "trial.status.expired",
      operator_granted: "trial.status.operator",
      trialing: "trial.status.trialing",
    } as const;
    return (
      <ProductNotice
        title={t("trial.accountStatus")}
        description={t(statusDescriptions[entitlement.status])}
        tone="warning"
      />
    );
  }

  const expired = entitlement.status === "expired";
  const activeTrial = !expired;
  const videoUsage = entitlement.usage?.heygen_generations;
  const usageItems = [
    {
      label: "trial.feature.leo",
      usage: entitlement.usage?.leo_generations,
      included: (entitlement.usage?.leo_generations?.limit ?? 0) > 0,
    },
    {
      label: "trial.feature.sofia",
      usage: entitlement.usage?.sofia_requests,
      included: (entitlement.usage?.sofia_requests?.limit ?? 0) > 0,
    },
    {
      label: "trial.feature.analytics",
      usage: entitlement.usage?.edian_analyses,
      included: (entitlement.usage?.edian_analyses?.limit ?? 0) > 0,
    },
    {
      label: "trial.feature.campaigns",
      usage: entitlement.usage?.campaigns,
      included: (entitlement.usage?.campaigns?.limit ?? 0) > 0,
    },
    {
      label: "trial.feature.heygen",
      usage: videoUsage,
      included:
        entitlement.features.heygen_generation && (videoUsage?.limit ?? 0) > 0,
    },
  ] as const;
  const featureItems = [
    {
      label: "trial.feature.leo",
      status:
        activeTrial && (entitlement.usage?.leo_generations?.limit ?? 0) > 0
          ? "limited"
          : "unavailable",
    },
    {
      label: "trial.feature.sofia",
      status:
        activeTrial && (entitlement.usage?.sofia_requests?.limit ?? 0) > 0
          ? "limited"
          : "unavailable",
    },
    {
      label: "trial.feature.facebook",
      status:
        activeTrial && entitlement.features.facebook_publishing
          ? "available"
          : "unavailable",
    },
    {
      label: "trial.feature.heygen",
      status:
        activeTrial && entitlement.features.heygen_generation
          ? "limited"
          : "unavailable",
    },
    {
      label: "trial.feature.image",
      status: "unavailable",
    },
    {
      label: "trial.feature.campaigns",
      status:
        activeTrial && (entitlement.usage?.campaigns?.limit ?? 0) > 0
          ? "limited"
          : "unavailable",
    },
    {
      label: "trial.feature.analytics",
      status:
        activeTrial && (entitlement.usage?.edian_analyses?.limit ?? 0) > 0
          ? "limited"
          : "unavailable",
    },
  ] as const;
  const featureStatusMessages = {
    available: "trial.featureStatus.available",
    limited: "trial.featureStatus.limited",
    unavailable: "trial.featureStatus.unavailable",
    planned: "trial.featureStatus.planned",
  } as const;
  return (
    <ProductNotice
      title={expired ? t("trial.expired") : t("trial.active")}
      description={
        expired
          ? t("trial.expiredHelp")
          : t("trial.daysRemaining", {
              count: entitlement.days_remaining ?? 0,
            })
      }
      tone={expired ? "warning" : "positive"}
    >
      <div className="trial-usage-grid" aria-label={t("trial.usageTitle")}>
        {usageItems.map(({ label, usage, included }) =>
          usage ? (
            <article className="trial-usage-card" key={label}>
              <div className="trial-usage-card__heading">
                <span>{t(label)}</span>
                <strong className={included ? "" : "trial-usage-not-included"}>
                  {included
                    ? `${usage.used} / ${usage.limit}`
                    : t("trial.notIncluded")}
                </strong>
              </div>
              {included && (
                <div
                  className="trial-usage-meter"
                  role="progressbar"
                  aria-label={t(label)}
                  aria-valuemin={0}
                  aria-valuemax={usage.limit}
                  aria-valuenow={Math.min(usage.used, usage.limit)}
                >
                  <span
                    style={{
                      width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </article>
          ) : null,
        )}
      </div>
      <ul className="trial-features" aria-label={t("trial.featureTitle")}>
        {featureItems.map(({ label, status }) => {
          return (
            <li
              className={`trial-feature-status trial-feature-status--${status}`}
              key={label}
            >
              <span>{t(label)}</span>
              <strong>{t(featureStatusMessages[status])}</strong>
            </li>
          );
        })}
      </ul>
      <p className="trial-subscription-note">
        {t("trial.subscriptionUnavailable")}
      </p>
    </ProductNotice>
  );
}
