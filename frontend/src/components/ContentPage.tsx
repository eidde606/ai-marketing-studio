import { useMemo, useState } from "react";
import { Image, Search, Video } from "lucide-react";
import {
  getFacebookAnalytics,
  getDraftImage,
  type Draft,
  type FacebookAnalytics,
} from "../services/draftsApi";
import { fetchVideoPreview } from "../features/media/services/videoApi";
import { useLocalization } from "../app/localization";

type Props = {
  drafts: Draft[];
  loading: boolean;
  error: string | null;
};

type ContentFilter = "all" | "pending" | "approved" | "published" | "rejected";

function draftStatus(
  draft: Draft,
): { status: Exclude<ContentFilter, "all">; tone: string } {
  if (
    draft.facebook_publish_status === "published" ||
    draft.tiktok_publish_status === "published"
  )
    return { status: "published", tone: "published" };
  if (draft.status === "approved") return { status: "approved", tone: "approved" };
  if (draft.status === "rejected") return { status: "rejected", tone: "rejected" };
  return { status: "pending", tone: "pending" };
}

export default function ContentPage({ drafts, loading, error }: Props) {
  const { locale, t } = useLocalization();
  const [analytics, setAnalytics] = useState<Record<string, FacebookAnalytics>>(
    {},
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ContentFilter>("all");

  const availableDrafts = useMemo(
    () => drafts.filter((draft) => !draft.deleted_at),
    [drafts],
  );
  const filteredDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return availableDrafts.filter((draft) => {
      const state = draftStatus(draft);
      const includesQuery =
        !normalizedQuery ||
        `${draft.title} ${draft.caption} ${draft.platform}`
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery);
      const includesFilter = filter === "all" || filter === state.status;
      return includesQuery && includesFilter;
    });
  }, [availableDrafts, filter, locale, query]);

  async function handleViewAnalytics(draftId: string) {
    setLoadingId(draftId);
    setAnalyticsError(null);
    try {
      const data = await getFacebookAnalytics(draftId);
      setAnalytics((current) => ({ ...current, [draftId]: data }));
    } catch {
      setAnalyticsError(t("content.analyticsError"));
    } finally {
      setLoadingId(null);
    }
  }

  async function handlePreview(draft: Draft) {
    if (previewLoadingId) return;
    setPreviewLoadingId(draft.id);
    setPreviewError(null);
    try {
      const previewUrl =
        draft.media_type === "video"
          ? (await fetchVideoPreview(draft.id)).video_url
          : (await getDraftImage(draft.id)).image_url;
      setPreviewUrls((current) => ({ ...current, [draft.id]: previewUrl }));
    } catch (previewFailure) {
      setPreviewError(
        previewFailure instanceof Error
          ? previewFailure.message
          : t("content.previewError"),
      );
    } finally {
      setPreviewLoadingId(null);
    }
  }

  if (loading) {
    return (
      <section className="content-workspace">
        <p className="workspace-state" role="status">
          {t("content.loading")}
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="content-workspace">
        <p className="workspace-state workspace-state--error" role="alert">
          {error}
        </p>
      </section>
    );
  }

  return (
    <div className="content-workspace">
      <section className="page-intro">
        <div>
          <span className="eyebrow">{t("content.introEyebrow")}</span>
          <h2>{t("content.title")}</h2>
          <p>{t("content.description")}</p>
        </div>
        <span className="content-library-count">
          {t("content.itemCount", {
            count: availableDrafts.length,
            item: t(
              availableDrafts.length === 1
                ? "content.itemSingular"
                : "content.itemPlural",
            ),
          })}
        </span>
      </section>

      <section
        className="content-toolbar"
        aria-label={t("content.searchAndFilter")}
      >
        <label className="content-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">{t("content.searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("content.searchPlaceholder")}
          />
        </label>
        <label className="content-filter">
          <span>{t("content.statusFilter")}</span>
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as ContentFilter)
            }
          >
            {(
              [
                ["all", "content.filter.all"],
                ["pending", "content.filter.pending"],
                ["approved", "content.filter.approved"],
                ["published", "content.filter.published"],
                ["rejected", "content.filter.rejected"],
              ] as const
            ).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {filteredDrafts.length === 0 ? (
        <section className="content-empty">
          <span className="content-empty__icon"><Image size={22} aria-hidden="true" /></span>
          <h3>
            {t(
              availableDrafts.length
                ? "content.emptyResults"
                : "content.emptyLibrary",
            )}
          </h3>
          <p>
            {availableDrafts.length
              ? t("content.refineSearch")
              : t("content.libraryEmpty")}
          </p>
        </section>
      ) : (
        <div className="content-library-grid">
          {filteredDrafts.map((draft) => {
            const state = draftStatus(draft);
            const isFacebookPublished =
              draft.facebook_publish_status === "published" &&
              Boolean(draft.facebook_post_id);
            const previewUrl = previewUrls[draft.id];
            const postAnalytics = analytics[draft.id];

            return (
              <article className="content-library-card" key={draft.id}>
                <div className="content-library-card__media">
                  {previewUrl && draft.media_type === "video" ? (
                    <video
                      src={previewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={t("content.previewOf", {
                        title: draft.title,
                      })}
                    />
                  ) : previewUrl && draft.media_type === "image" ? (
                    <img
                      src={previewUrl}
                      alt={t("content.previewOf", { title: draft.title })}
                    />
                  ) : (
                    <span aria-hidden="true">
                      {draft.media_type === "video" ? (
                        <Video size={26} />
                      ) : (
                        <Image size={26} />
                      )}
                    </span>
                  )}
                  {draft.media_type !== "text" && !previewUrl && (
                    <button
                      type="button"
                      className="content-preview-button"
                      disabled={previewLoadingId !== null}
                      onClick={() => void handlePreview(draft)}
                    >
                      {previewLoadingId === draft.id
                        ? t("content.previewLoading")
                        : t("content.preview")}
                    </button>
                  )}
                </div>
                <div className="content-library-card__body">
                  <div className="content-library-card__meta">
                    <span>{draft.platform}</span>
                    <span className={`content-state content-state--${state.tone}`}>
                      {t(
                        `content.statusLabel.${state.status}` as
                          | "content.statusLabel.published"
                          | "content.statusLabel.approved"
                          | "content.statusLabel.rejected"
                          | "content.statusLabel.pending",
                      )}
                    </span>
                  </div>
                  <h3>{draft.title}</h3>
                  <p className="content-library-card__caption">{draft.caption}</p>
                  <div className="content-library-card__footer">
                    <span>
                      {draft.source === "ai"
                        ? t("content.createdWithAI")
                        : t("content.createdManually")}
                    </span>
                    {draft.facebook_publish_status === "published" && (
                      <button
                        type="button"
                        className="quiet-link"
                        disabled={loadingId !== null || !isFacebookPublished}
                        onClick={() => void handleViewAnalytics(draft.id)}
                      >
                        {loadingId === draft.id
                          ? t("content.metricsLoading")
                          : postAnalytics
                            ? t("content.refreshMetrics")
                            : t("content.viewMetrics")}
                      </button>
                    )}
                  </div>
                  {postAnalytics && (
                    <div
                      className="content-card-analytics"
                      aria-label={t("content.facebookMetrics")}
                    >
                      <span>
                        {postAnalytics.reactions} {t("content.reactions")}
                      </span>
                      <span>
                        {postAnalytics.comments} {t("content.comments")}
                      </span>
                      <span>
                        {postAnalytics.shares} {t("content.shares")}
                      </span>
                      {postAnalytics.permalink_url && (
                        <a
                          href={postAnalytics.permalink_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("content.openPost")}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {previewError && <p className="workspace-message--error" role="alert">{previewError}</p>}
      {analyticsError && <p className="workspace-message--error" role="alert">{analyticsError}</p>}
    </div>
  );
}
