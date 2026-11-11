import { useMemo, useState } from "react";
import { Image, Search, Video } from "lucide-react";
import {
  getFacebookAnalytics,
  getDraftImage,
  type Draft,
  type FacebookAnalytics,
} from "../services/draftsApi";
import { fetchVideoPreview } from "../features/media/services/videoApi";

type Props = {
  drafts: Draft[];
  loading: boolean;
  error: string | null;
};

type ContentFilter = "all" | "pending" | "approved" | "published" | "rejected";

const filterLabels: Record<ContentFilter, string> = {
  all: "Todo el contenido",
  pending: "Pendiente",
  approved: "Aprobado",
  published: "Publicado",
  rejected: "Rechazado",
};

function draftStatus(draft: Draft): { label: string; tone: string } {
  if (
    draft.facebook_publish_status === "published" ||
    draft.tiktok_publish_status === "published"
  )
    return { label: "Publicado", tone: "published" };
  if (draft.status === "approved") return { label: "Aprobado", tone: "approved" };
  if (draft.status === "rejected") return { label: "Rechazado", tone: "rejected" };
  return { label: "Pendiente de revisión", tone: "pending" };
}

export default function ContentPage({ drafts, loading, error }: Props) {
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
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return availableDrafts.filter((draft) => {
      const state = draftStatus(draft);
      const includesQuery =
        !normalizedQuery ||
        `${draft.title} ${draft.caption} ${draft.platform}`
          .toLocaleLowerCase("es")
          .includes(normalizedQuery);
      const includesFilter =
        filter === "all" ||
        (filter === "published" && state.label === "Publicado") ||
        (filter === "pending" && state.label === "Pendiente de revisión") ||
        (filter === "approved" && state.label === "Aprobado") ||
        (filter === "rejected" && state.label === "Rechazado");
      return includesQuery && includesFilter;
    });
  }, [availableDrafts, filter, query]);

  async function handleViewAnalytics(draftId: string) {
    setLoadingId(draftId);
    setAnalyticsError(null);
    try {
      const data = await getFacebookAnalytics(draftId);
      setAnalytics((current) => ({ ...current, [draftId]: data }));
    } catch {
      setAnalyticsError("No se pudieron cargar las métricas de Facebook.");
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
          : "No se pudo cargar la vista previa.",
      );
    } finally {
      setPreviewLoadingId(null);
    }
  }

  if (loading) {
    return (
      <section className="content-workspace">
        <p className="workspace-state" role="status">Cargando contenido…</p>
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
          <span className="eyebrow">Crea y organiza</span>
          <h2>Biblioteca de contenido</h2>
          <p>Encuentra borradores, revisa su estado y consulta publicaciones.</p>
        </div>
        <span className="content-library-count">
          {availableDrafts.length} {availableDrafts.length === 1 ? "pieza" : "piezas"}
        </span>
      </section>

      <section className="content-toolbar" aria-label="Buscar y filtrar contenido">
        <label className="content-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Buscar contenido</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por título, texto o plataforma"
          />
        </label>
        <label className="content-filter">
          <span>Estado</span>
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as ContentFilter)
            }
          >
            {Object.entries(filterLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </section>

      {filteredDrafts.length === 0 ? (
        <section className="content-empty">
          <span className="content-empty__icon"><Image size={22} aria-hidden="true" /></span>
          <h3>{availableDrafts.length ? "No hay resultados" : "Tu biblioteca está lista"}</h3>
          <p>
            {availableDrafts.length
              ? "Prueba con otros términos o cambia el filtro de estado."
              : "El contenido creado y publicado para este negocio aparecerá aquí."}
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
                      aria-label={`Vista previa de ${draft.title}`}
                    />
                  ) : previewUrl && draft.media_type === "image" ? (
                    <img src={previewUrl} alt={`Vista previa de ${draft.title}`} />
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
                        ? "Cargando vista previa…"
                        : "Ver vista previa"}
                    </button>
                  )}
                </div>
                <div className="content-library-card__body">
                  <div className="content-library-card__meta">
                    <span>{draft.platform}</span>
                    <span className={`content-state content-state--${state.tone}`}>
                      {state.label}
                    </span>
                  </div>
                  <h3>{draft.title}</h3>
                  <p className="content-library-card__caption">{draft.caption}</p>
                  <div className="content-library-card__footer">
                    <span>
                      {draft.source === "ai" ? "Creado con IA" : "Creado manualmente"}
                    </span>
                    {draft.facebook_publish_status === "published" && (
                      <button
                        type="button"
                        className="quiet-link"
                        disabled={loadingId !== null || !isFacebookPublished}
                        onClick={() => void handleViewAnalytics(draft.id)}
                      >
                        {loadingId === draft.id
                          ? "Cargando…"
                          : postAnalytics
                            ? "Actualizar métricas"
                            : "Ver métricas"}
                      </button>
                    )}
                  </div>
                  {postAnalytics && (
                    <div className="content-card-analytics" aria-label="Métricas de Facebook">
                      <span>{postAnalytics.reactions} reacciones</span>
                      <span>{postAnalytics.comments} comentarios</span>
                      <span>{postAnalytics.shares} compartidos</span>
                      {postAnalytics.permalink_url && (
                        <a
                          href={postAnalytics.permalink_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir publicación
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
