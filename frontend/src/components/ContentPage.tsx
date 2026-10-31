import { useState } from "react";
import {
  getFacebookAnalytics,
  type Draft,
  type FacebookAnalytics,
} from "../services/draftsApi";

type Props = {
  drafts: Draft[];
  loading: boolean;
  error: string | null;
};

export default function ContentPage({ drafts, loading, error }: Props) {
  const [analytics, setAnalytics] = useState<Record<string, FacebookAnalytics>>(
    {},
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

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

  if (loading)
    return <section className="panel">Cargando contenido...</section>;
  if (error)
    return (
      <section className="panel" role="alert">
        {error}
      </section>
    );

  return (
    <section className="panel content-page">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Biblioteca de contenido</span>
          <h2>Contenido generado</h2>
          <p>Explora y analiza las publicaciones de tu negocio.</p>
        </div>
      </div>

      {drafts.length === 0 ? (
        <p>No hay contenido para este negocio todavía.</p>
      ) : (
        <div className="content-grid">
          {drafts.map((draft) => {
            const isPublished = draft.facebook_publish_status === "published";

            const isFacebookPublished =
              draft.facebook_publish_status === "published" &&
              Boolean(draft.facebook_post_id);

            const statusLabel = isPublished
              ? "Publicado"
              : draft.status === "approved"
                ? "Aprobado"
                : "Pendiente";

            const postAnalytics = analytics[draft.id];

            return (
              <article className="content-card" key={draft.id}>
                <div className="content-card-header">
                  <span className="content-platform">
                    {draft.facebook_publish_status === "published"
                      ? "Facebook"
                      : draft.platform}
                  </span>

                  <span
                    className={`content-status ${
                      isPublished ? "published" : "pending"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>

                <h3>{draft.title}</h3>

                <p className="content-caption">{draft.caption}</p>

                {postAnalytics && (
                  <div className="content-analytics">
                    <p>❤️ {postAnalytics.reactions} reacciones</p>
                    <p>💬 {postAnalytics.comments} comentarios</p>
                    <p>🔁 {postAnalytics.shares} compartidos</p>

                    {postAnalytics.permalink_url && (
                      <a
                        href={postAnalytics.permalink_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver publicación en Facebook
                      </a>
                    )}
                  </div>
                )}

                <div className="content-card-footer">
                  {isPublished && (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={loadingId !== null || !isFacebookPublished}
                      onClick={() => void handleViewAnalytics(draft.id)}
                    >
                      {!isFacebookPublished
                        ? "Análisis próximamente"
                        : loadingId === draft.id
                          ? "Cargando..."
                          : "Ver análisis"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {analyticsError && <p role="alert">{analyticsError}</p>}
    </section>
  );
}
