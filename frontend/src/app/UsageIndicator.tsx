import { useEffect, useState } from "react";
import { getHeyGenUsage, type HeyGenUsage } from "../services/accountApi";
import { useLocalization } from "./localization";

export default function UsageIndicator({ businessId }: { businessId: string }) {
  const { t } = useLocalization();
  const [state, setState] = useState<{
    businessId: string;
    usage: HeyGenUsage | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!businessId) {
      return () => {
        active = false;
      };
    }

    getHeyGenUsage(businessId)
      .then((result) => {
        if (result.configured !== Boolean(result.limits)) {
          throw new Error("HeyGen usage response is inconsistent.");
        }
        if (active) {
          setState({
            businessId,
            usage: result,
            loading: false,
            error: false,
          });
        }
      })
      .catch(() => {
        if (active) {
          setState({ businessId, usage: null, loading: false, error: true });
        }
      });

    return () => {
      active = false;
    };
  }, [businessId, refreshVersion]);

  if (!businessId) return null;
  const currentState =
    state?.businessId === businessId
      ? state
      : { businessId, usage: null, loading: true, error: false };
  const { usage, loading, error } = currentState;

  return (
    <section
      className="settings-usage panel"
      aria-labelledby="heygen-usage-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="heygen-usage-title">{t("usage.heygenTitle")}</h3>
          <p>{t("usage.heygenNote")}</p>
        </div>
      </div>
      {loading ? (
        <p role="status">{t("usage.loading")}</p>
      ) : error ? (
        <div role="alert">
          <span>{t("usage.unavailable")}</span>
          <button
            type="button"
            onClick={() => setRefreshVersion((version) => version + 1)}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : usage && !usage.configured ? (
        <p role="status">{t("usage.unconfigured")}</p>
      ) : usage?.configured && usage.limits ? (
        <div className="settings-usage__details">
          <p>
            {t("usage.attempts", {
              used: usage.attempts_used,
              limit: usage.limits.max_generations,
            })}
          </p>
          {usage.limits.max_generations > 0 && (
            <div
              className="settings-usage__meter"
              role="meter"
              aria-label={t("usage.heygenTitle")}
              aria-valuemin={0}
              aria-valuemax={usage.limits.max_generations}
              aria-valuenow={Math.min(
                usage.attempts_used,
                usage.limits.max_generations,
              )}
            >
              <span
                style={{
                  width: `${Math.min(
                    100,
                    (usage.attempts_used / usage.limits.max_generations) * 100,
                  )}%`,
                }}
              />
            </div>
          )}
          <p>{t("usage.remaining", { count: usage.remaining_generations })}</p>
          <p>{t("usage.active", { count: usage.active_jobs })}</p>
          <small>{t("usage.lifetime")}</small>
        </div>
      ) : null}
    </section>
  );
}
