import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  MessageCircle,
  Share2,
  ThumbsUp,
} from "lucide-react";
import {
  getFacebookAnalytics,
  type Draft,
  type FacebookAnalytics,
} from "../services/draftsApi";
import {
  analyzeWithEdian,
  type EdianAnalysis,
} from "../services/edianAnalyticsApi";
import { ApiError } from "../lib/apiClient";
import { useLocalization } from "../app/useLocalization";

type Props = {
  businessId: string;
  drafts: Draft[];
  loading: boolean;
  error: string | null;
  onDiscussWithSebastian?: (summary: string) => void;
};

type EngagementMetric = "reactions" | "comments" | "shares";

function metricValue(
  analytics: FacebookAnalytics[],
  metric: EngagementMetric,
  locale: string,
): string {
  const available = analytics
    .map((post) => post[metric])
    .filter((value): value is number => typeof value === "number");
  return available.length
    ? available
        .reduce((total, value) => total + value, 0)
        .toLocaleString(locale)
    : "—";
}

function postMetric(value: number | null, locale: string): string {
  return typeof value === "number" ? value.toLocaleString(locale) : "—";
}

function hasMetric(analytics: FacebookAnalytics[], metric: EngagementMetric) {
  return analytics.some((post) => typeof post[metric] === "number");
}

function strategyHandoffMessage(
  analysis: EdianAnalysis,
  t: ReturnType<typeof useLocalization>["t"],
  locale: string,
) {
  const observedPosts =
    analysis.observed?.posts_analyzed ?? analysis.posts_analyzed;
  const lines = [
    t("analytics.strategyHandoffIntro"),
    t("analytics.edianObservedPosts", { count: observedPosts }),
    ...(["reactions", "comments", "shares"] as const).map((metric) => {
      const observed = analysis.observed?.metrics[metric];
      return `- ${t(`analytics.${metric}`)}: ${postMetric(observed?.total ?? null, locale)} (${t(
        "analytics.edianMetricCoverage",
        {
          available: observed?.posts_with_data ?? 0,
          count: observedPosts,
        },
      )})`;
    }),
  ];

  if (analysis.interpretation?.summary) {
    lines.push(
      t("analytics.strategyHandoffSummary", {
        summary: analysis.interpretation.summary,
      }),
    );
  }
  const recommendations =
    analysis.interpretation?.recommendations.slice(0, 2) ?? [];
  if (recommendations.length > 0) {
    lines.push(
      t("analytics.strategyHandoffRecommendations", {
        recommendations: recommendations.join("; "),
      }),
    );
  }
  lines.push(t("analytics.strategyHandoffQuestion"));
  return lines.join("\n");
}

export default function AnalyticsPage({
  businessId,
  drafts,
  loading,
  error,
  onDiscussWithSebastian,
}: Props) {
  const { locale, t } = useLocalization();
  const interfaceLocale = locale === "es" ? "es" : "en";
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
    code: string | null;
  } | null>(null);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [edianAnalysis, setEdianAnalysis] = useState<EdianAnalysis | null>(
    null,
  );
  const [edianLoading, setEdianLoading] = useState(false);
  const [edianError, setEdianError] = useState<string | null>(null);
  const edianRequestInFlight = useRef(false);
  const requestKey = `${JSON.stringify(publishedDrafts.map((draft) => draft.id))}:${retryCount}`;
  const analyticsLoading = completedRequestKey !== requestKey;
  const analyticsError =
    analyticsFailure?.requestKey === requestKey
      ? t(
          analyticsFailure.code === "facebook_provider_error"
            ? "analytics.providerError"
            : "analytics.loadError",
        )
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
        let errorCode: string | null = null;
        for (const result of results) {
          if (result.status === "fulfilled") values.push(result.value);
          else {
            failures += 1;
            if (
              result.reason instanceof ApiError &&
              result.reason.code === "facebook_provider_error"
            ) {
              errorCode = result.reason.code;
            }
          }
        }
        setAnalytics(values);
        setUnavailableCount(failures);
        setAnalyticsFailure(errorCode ? { requestKey, code: errorCode } : null);
        setCompletedRequestKey(requestKey);
      })
      .catch(() => {
        if (!cancelled) {
          setAnalyticsFailure({
            requestKey,
            code: null,
          });
          setCompletedRequestKey(requestKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [publishedDrafts, loading, error, requestKey]);

  const analyticsByDraft = new Map(
    analytics.map((item) => [item.draft_id, item]),
  );
  const postsWithMetrics = analytics.filter(
    (post) =>
      typeof post.reactions === "number" ||
      typeof post.comments === "number" ||
      typeof post.shares === "number",
  ).length;
  const permissionRequiredCount = analytics.filter(
    (post) =>
      post.authorization_status === "permission_required" ||
      Object.values(post.metric_status ?? {}).includes("permission_required"),
  ).length;
  const reauthorizationRequired = analytics.some(
    (post) => post.authorization_status === "reauthorization_required",
  );
  const unavailablePosts = analytics.filter(
    (post) => post.post_status === "unavailable",
  ).length;
  const handleEdianAnalysis = async () => {
    if (edianRequestInFlight.current || !businessId) return;
    edianRequestInFlight.current = true;
    setEdianLoading(true);
    setEdianError(null);
    setEdianAnalysis(null);
    try {
      const result = await analyzeWithEdian(
        businessId,
        interfaceLocale,
        crypto.randomUUID(),
      );
      setEdianAnalysis(result);
    } catch (requestError) {
      setEdianError(
        requestError instanceof ApiError && requestError.status === 429
          ? t("analytics.quotaError")
          : t("analytics.interpretError"),
      );
    } finally {
      edianRequestInFlight.current = false;
      setEdianLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="analytics-workspace" data-guide-target="mia-analytics">
        <p className="workspace-state" role="status">
          {t("analytics.loading")}
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="analytics-workspace" data-guide-target="mia-analytics">
        <p className="workspace-state workspace-state--error" role="alert">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="analytics-workspace" data-guide-target="mia-analytics">
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
        <p>{t("analytics.sourceNote")}</p>
      </section>

      {analyticsLoading ? (
        <p className="workspace-state" role="status">
          {t("analytics.querying")}
        </p>
      ) : analyticsError ? (
        <p className="workspace-state workspace-state--error" role="alert">
          {analyticsError}
        </p>
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
              <strong>{metricValue(analytics, "reactions", locale)}</strong>
              <span>
                {t(
                  hasMetric(analytics, "reactions")
                    ? "analytics.accessibleTotal"
                    : "analytics.noData",
                )}
              </span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--green">
                <MessageCircle size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.comments")}</small>
              <strong>{metricValue(analytics, "comments", locale)}</strong>
              <span>
                {t(
                  hasMetric(analytics, "comments")
                    ? "analytics.accessibleTotal"
                    : "analytics.noData",
                )}
              </span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--amber">
                <Share2 size={18} aria-hidden="true" />
              </span>
              <small>{t("analytics.shares")}</small>
              <strong>{metricValue(analytics, "shares", locale)}</strong>
              <span>
                {t(
                  hasMetric(analytics, "shares")
                    ? "analytics.accessibleTotal"
                    : "analytics.noData",
                )}
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
          {reauthorizationRequired && (
            <p className="analytics-provider-notice" role="alert">
              {t("analytics.reauthorizationRequired")}
            </p>
          )}
          {permissionRequiredCount > 0 && (
            <p className="analytics-provider-notice" role="alert">
              {t(
                permissionRequiredCount === 1
                  ? "analytics.permissionRequiredOne"
                  : "analytics.permissionRequiredMany",
                { count: permissionRequiredCount },
              )}
            </p>
          )}
          {unavailablePosts > 0 && (
            <p className="analytics-warning" role="status">
              {t(
                unavailablePosts === 1
                  ? "analytics.postUnavailableOne"
                  : "analytics.postUnavailableMany",
                { count: unavailablePosts },
              )}
            </p>
          )}

          <section className="edian-analysis" aria-labelledby="edian-title">
            <div className="edian-analysis__heading">
              <div>
                <span className="eyebrow">{t("analytics.edianEyebrow")}</span>
                <h3 id="edian-title">Edian</h3>
                <p>{t("analytics.edianDescription")}</p>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled={edianLoading || analyticsLoading || !businessId}
                onClick={() => void handleEdianAnalysis()}
              >
                {edianLoading
                  ? t("analytics.edianLoading")
                  : t("analytics.edianAction")}
              </button>
            </div>
            {edianLoading && (
              <p className="workspace-state" role="status">
                {t("analytics.edianLoading")}
              </p>
            )}
            {edianError && (
              <p
                className="workspace-state workspace-state--error"
                role="alert"
              >
                {edianError}
              </p>
            )}
            {edianAnalysis?.locale === interfaceLocale &&
              (edianAnalysis.status === "unavailable" ? (
                <p className="analytics-warning" role="status">
                  {t("analytics.integrationUnavailable")}
                </p>
              ) : edianAnalysis.status === "no_data" ? (
                <p className="analytics-empty" role="status">
                  {t(
                    edianAnalysis.posts_analyzed === 0
                      ? "analytics.noFacebookPosts"
                      : "analytics.edianNoMetrics",
                  )}
                </p>
              ) : (
                <>
                  {edianAnalysis.observed && (
                    <section
                      className="edian-analysis__observed"
                      aria-labelledby="edian-observed-title"
                    >
                      <h4 id="edian-observed-title">
                        {t("analytics.observed")}
                      </h4>
                      <p>
                        {t("analytics.edianObservedPosts", {
                          count: edianAnalysis.posts_analyzed,
                        })}
                      </p>
                      <dl>
                        {(["reactions", "comments", "shares"] as const).map(
                          (metric) => (
                            <div key={metric}>
                              <dt>{t(`analytics.${metric}`)}</dt>
                              <dd>
                                {postMetric(
                                  edianAnalysis.observed?.metrics[metric]
                                    .total ?? null,
                                  locale,
                                )}
                              </dd>
                              <small>
                                {t("analytics.edianMetricCoverage", {
                                  available:
                                    edianAnalysis.observed?.metrics[metric]
                                      .posts_with_data ?? 0,
                                  count: edianAnalysis.posts_analyzed,
                                })}
                              </small>
                            </div>
                          ),
                        )}
                      </dl>
                    </section>
                  )}
                  {edianAnalysis.interpretation && (
                    <section
                      className="edian-analysis__recommendations"
                      aria-labelledby="edian-recommendations-title"
                    >
                      <h4 id="edian-recommendations-title">
                        {t("analytics.recommendations")}
                      </h4>
                      <p>{edianAnalysis.interpretation.summary}</p>
                      {edianAnalysis.interpretation.recommendations.length >
                        0 && (
                        <ul>
                          {edianAnalysis.interpretation.recommendations.map(
                            (recommendation, index) => (
                              <li key={`${index}-${recommendation}`}>
                                {recommendation}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                      {onDiscussWithSebastian && (
                        <section
                          className="edian-action"
                          aria-labelledby="edian-action-title"
                        >
                          <div className="edian-action__copy">
                            <span
                              className="edian-action__icon"
                              aria-hidden="true"
                            >
                              <MessageCircle size={18} />
                            </span>
                            <div>
                              <h4 id="edian-action-title">
                                {t("analytics.actionTitle")}
                              </h4>
                              <p>{t("analytics.actionDescription")}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="edian-action__button"
                            onClick={() =>
                              onDiscussWithSebastian(
                                strategyHandoffMessage(
                                  edianAnalysis,
                                  t,
                                  interfaceLocale,
                                ),
                              )
                            }
                          >
                            <MessageCircle size={17} aria-hidden="true" />
                            <span>{t("analytics.discussWithSebastian")}</span>
                            <ArrowRight size={17} aria-hidden="true" />
                          </button>
                        </section>
                      )}
                    </section>
                  )}
                  {edianAnalysis.reused && (
                    <small role="status">{t("analytics.cachedAnalysis")}</small>
                  )}
                </>
              ))}
          </section>

          <section className="analytics-posts">
            <header className="analytics-posts__header">
              <div>
                <span className="eyebrow">{t("analytics.detail")}</span>
                <h3>{t("analytics.postsAnalyzed")}</h3>
              </div>
              <span>
                {t("analytics.withData", { count: postsWithMetrics })}
              </span>
            </header>
            {publishedDrafts.length === 0 ? (
              <div className="analytics-empty">
                <BarChart3 size={24} aria-hidden="true" />
                <strong>{t("analytics.noFacebookPosts")}</strong>
                <p>{t("analytics.postsWillAppear")}</p>
              </div>
            ) : postsWithMetrics === 0 ? (
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
                          {postMetric(item.reactions, locale)}{" "}
                          {t("analytics.reactions").toLocaleLowerCase(locale)}
                        </span>
                        <span>
                          {postMetric(item.comments, locale)}{" "}
                          {t("analytics.comments").toLocaleLowerCase(locale)}
                        </span>
                        <span>
                          {postMetric(item.shares, locale)}{" "}
                          {t("analytics.shares").toLocaleLowerCase(locale)}
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
