import { useEffect, useMemo, useState } from "react";
import { BarChart3, MessageCircle, Share2, ThumbsUp } from "lucide-react";
import {
  getFacebookAnalytics,
  type Draft,
  type FacebookAnalytics,
} from "../services/draftsApi";
import { useLocalization } from "../app/localization";

type Props = {
  drafts: Draft[];
  loading: boolean;
  error: string | null;
};

function metricValue(value: number, hasData: boolean, locale: string): string {
  return hasData ? value.toLocaleString(locale) : "—";
}

export default function AnalyticsPage({ drafts, loading, error }: Props) {
  const { locale, t } = useLocalization();
  const publishedDrafts = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          !draft.deleted_at &&
          draft.facebook_publish_status === "published" &&
          Boolean(draft.facebook_post_id),
      ),
    [drafts],
  );
  const [analytics, setAnalytics] = useState<FacebookAnalytics[]>([]);
  const [completedRequestKey, setCompletedRequestKey] = useState<string | null>(
    null,
  );
  const [analyticsFailure, setAnalyticsFailure] = useState<{
    requestKey: string;
  } | null>(null);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${JSON.stringify(publishedDrafts.map((draft) => draft.id))}:${retryCount}`;
  const analyticsLoading = completedRequestKey !== requestKey;
  const analyticsError =
    analyticsFailure?.requestKey === requestKey
      ? t("analytics.loadError")
      : null;

  useEffect(() => {
    if (loading || error) return;
    let cancelled = false;

    void Promise.allSettled(
      publishedDrafts.map((draft) => getFacebookAnalytics(draft.id)),
    )
      .then((results) => {
        if (cancelled) return;
        const values: FacebookAnalytics[] = [];
        let failures = 0;
        for (const result of results) {
          if (result.status === "fulfilled") values.push(result.value);
          else failures += 1;
        }
        setAnalytics(values);
        setUnavailableCount(failures);
        setCompletedRequestKey(requestKey);
      })
      .catch(() => {
        if (!cancelled) {
          setAnalyticsFailure({
            requestKey,
          });
          setCompletedRequestKey(requestKey);
        }
      })

    return () => {
      cancelled = true;
    };
  }, [publishedDrafts, loading, error, requestKey]);

  const totals = analytics.reduce(
    (result, post) => ({
      reactions: result.reactions + post.reactions,
      comments: result.comments + post.comments,
      shares: result.shares + post.shares,
    }),
    { reactions: 0, comments: 0, shares: 0 },
  );
  const analyticsByDraft = new Map(
    analytics.map((item) => [item.draft_id, item]),
  );
  const hasMetrics = analytics.length > 0;

  if (loading) {
    return (
      <div className="analytics-workspace">
        <p className="workspace-state" role="status">
          {t("analytics.loading")}
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="analytics-workspace">
        <p className="workspace-state workspace-state--error" role="alert">{error}</p>
      </div>
    );
  }

  return (
    <div className="analytics-workspace">
      <section className="page-intro">
        <div>
          <span className="eyebrow">{t("analytics.eyebrow")}</span>
          <h2>{t("analytics.title")}</h2>
          <p>{t("analytics.description")}</p>
        </div>
        <button
          type="button"
          className="outline-button"
          disabled={analyticsLoading}
          onClick={() => {
            setAnalyticsFailure(null);
            setRetryCount((count) => count + 1);
          }}
        >
          {analyticsLoading
            ? t("analytics.refreshing")
            : t("analytics.refreshMetrics")}
        </button>
      </section>

      <section className="analytics-source-note" role="note">
        <span className="analytics-source-note__icon">
          <BarChart3 size={18} aria-hidden="true" />
        </span>
        <p>
          {t("analytics.sourceNote")}
        </p>
      </section>

      {analyticsLoading ? (
        <p className="workspace-state" role="status">
          {t("analytics.querying")}
        </p>
      ) : analyticsError ? (
        <p className="workspace-state workspace-state--error" role="alert">{analyticsError}</p>
      ) : (
        <>
          <section
            className="analytics-metrics"
            aria-label={t("analytics.facebookMetrics")}
          >
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--violet">
                <BarChart3 size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.confirmedPosts")}</small>
              <strong>{publishedDrafts.length.toLocaleString(locale)}</strong>
              <span>{t("analytics.facebookHistory")}</span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--blue">
                <ThumbsUp size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.reactions")}</small>
              <strong>{metricValue(totals.reactions, hasMetrics, locale)}</strong>
              <span>
                {t(hasMetrics ? "analytics.accessibleTotal" : "analytics.noData")}
              </span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--green">
                <MessageCircle size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.comments")}</small>
              <strong>{metricValue(totals.comments, hasMetrics, locale)}</strong>
              <span>
                {t(hasMetrics ? "analytics.accessibleTotal" : "analytics.noData")}
              </span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--amber">
                <Share2 size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.shares")}</small>
              <strong>{metricValue(totals.shares, hasMetrics, locale)}</strong>
              <span>
                {t(hasMetrics ? "analytics.accessibleTotal" : "analytics.noData")}
              </span>
            </article>
          </section>

          {unavailableCount > 0 && (
            <p className="analytics-warning" role="status">
              {t(
                unavailableCount === 1
                  ? "analytics.unavailableOne"
                  : "analytics.unavailableMany",
                { count: unavailableCount },
              )}
            </p>
          )}

          <section className="analytics-posts">
            <header className="analytics-posts__header">
              <div>
                <span className="eyebrow">{t("analytics.detail")}</span>
                <h3>{t("analytics.postsAnalyzed")}</h3>
              </div>
              <span>{t("analytics.withData", { count: analytics.length })}</span>
            </header>
            {publishedDrafts.length === 0 ? (
              <div className="analytics-empty">
                <BarChart3 size={24} aria-hidden="true" />
                <strong>{t("analytics.noFacebookPosts")}</strong>
                <p>{t("analytics.postsWillAppear")}</p>
              </div>
            ) : analytics.length === 0 ? (
              <div className="analytics-empty">
                <strong>{t("analytics.noAvailableMetrics")}</strong>
                <p>
                  {t("analytics.postsNoMetrics", {
                    count: publishedDrafts.length,
                  })}
                </p>
              </div>
            ) : (
              <div className="analytics-post-list">
                {publishedDrafts.map((draft) => {
                  const item = analyticsByDraft.get(draft.id);
                  if (!item) return null;
                  return (
                    <article className="analytics-post" key={draft.id}>
                      <div className="analytics-post__title">
                        <strong>{draft.title}</strong>
                        <span>Facebook · {item.platform}</span>
                      </div>
                      <div className="analytics-post__metrics">
                        <span>
                          {item.reactions} {t("analytics.reactions").toLocaleLowerCase(locale)}
                        </span>
                        <span>
                          {item.comments} {t("analytics.comments").toLocaleLowerCase(locale)}
                        </span>
                        <span>
                          {item.shares} {t("analytics.shares").toLocaleLowerCase(locale)}
                        </span>
                      </div>
                      {item.permalink_url && (
                        <a
                          href={item.permalink_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("analytics.viewPost")}
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
