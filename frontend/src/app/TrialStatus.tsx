import { useEffect, useState } from "react";
import {
  getBusinessEntitlement,
  type BusinessEntitlement,
} from "../services/onboardingApi";
import { useLocalization } from "./localization";
import { ProductNotice } from "./ProductStatus";

export default function TrialStatus({ businessId }: { businessId: string }) {
  const { t } = useLocalization();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    businessId: string;
    result: BusinessEntitlement | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!businessId)
      return () => {
        active = false;
      };
    getBusinessEntitlement(businessId)
      .then((result) => {
        if (active) setState({ businessId, result, error: false });
      })
      .catch(() => {
        if (active) setState({ businessId, result: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [businessId, reload]);

  if (!businessId) return null;
  const current = state?.businessId === businessId ? state : null;
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
  const leo = entitlement.usage?.leo_generations;
  const sofia = entitlement.usage?.sofia_requests;
  const heygen = entitlement.usage?.heygen_generations;
  const campaigns = entitlement.usage?.campaigns;
  const featureKeys = [
    ["trial.feature.leo", "leo_generation"],
    ["trial.feature.sofia", "sofia_requests"],
    ["trial.feature.facebook", "facebook_publishing"],
    ["trial.feature.heygen", "heygen_generation"],
    ["trial.feature.campaigns", "campaign_creation"],
  ] as const;
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
      {leo && (
        <p>
          {t("trial.generationsUsed", { used: leo.used, limit: leo.limit })}
        </p>
      )}
      {sofia && (
        <p>{t("trial.sofiaUsed", { used: sofia.used, limit: sofia.limit })}</p>
      )}
      {heygen && (
        <p>
          {t("trial.heygenUsed", { used: heygen.used, limit: heygen.limit })}
        </p>
      )}
      {campaigns && (
        <p>
          {t("trial.campaignsUsed", {
            used: campaigns.used,
            limit: campaigns.limit,
          })}
        </p>
      )}
      <ul className="trial-features">
        {featureKeys.map(([label, feature]) => (
          <li key={feature}>
            {t(label)} —{" "}
            {entitlement.features[feature]
              ? t("trial.featureAvailable")
              : t("trial.featureUnavailable")}
          </li>
        ))}
      </ul>
      <p>{t("trial.subscriptionUnavailable")}</p>
    </ProductNotice>
  );
}
