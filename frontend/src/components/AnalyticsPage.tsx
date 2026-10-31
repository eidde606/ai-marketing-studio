import { useEffect, useState } from "react";
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

export default function AnalyticsPage({ drafts, loading, error }: Props) {
  const publishedDrafts = drafts.filter(
    (draft) => draft.facebook_publish_status === "published",
  );

  const [analytics, setAnalytics] = useState<FacebookAnalytics[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [unavailableCount, setUnavailableCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      setAnalytics([]);
      setUnavailableCount(0);

      try {
        const published = drafts.filter(
          (draft) => draft.facebook_publish_status === "published",
        );

        const results = await Promise.allSettled(
          published.map((draft) => getFacebookAnalytics(draft.id)),
        );

        if (cancelled) return;

        const successful: FacebookAnalytics[] = [];
        let failed = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            successful.push(result.value);
          } else {
            failed++;
          }
        }

        setAnalytics(successful);
        setUnavailableCount(failed);
      } catch {
        if (!cancelled) {
          setAnalyticsError("No se pudieron procesar las analíticas.");
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
        }
      }
    }

    if (!loading && !error) {
      void loadAnalytics();
    }

    return () => {
      cancelled = true;
    };
  }, [drafts, loading, error]);

  if (loading) {
    return <p>Cargando analíticas...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  const totalReactions = analytics.reduce(
    (total, post) => total + post.reactions,
    0,
  );

  const totalComments = analytics.reduce(
    (total, post) => total + post.comments,
    0,
  );

  const totalShares = analytics.reduce((total, post) => total + post.shares, 0);

  return (
    <section className="panel">
      <div className="analytics-heading">
        <div>
          <h2>Analíticas de Facebook</h2>
          <p>Rendimiento de las publicaciones de este negocio.</p>
        </div>
      </div>

      {analyticsLoading ? (
        <p>Cargando métricas de Facebook...</p>
      ) : analyticsError ? (
        <p>{analyticsError}</p>
      ) : (
        <>
          <div className="analytics-grid">
            <div className="analytics-card">
              <span>Publicaciones registradas</span>
              <strong>{publishedDrafts.length}</strong>
              <small>Historial de publicaciones</small>
            </div>

            <div className="analytics-card">
              <span>Métricas disponibles</span>
              <strong>{analytics.length}</strong>
              <small>Publicaciones con datos accesibles</small>
            </div>

            <div className="analytics-card">
              <span>Reacciones</span>
              <strong>{totalReactions}</strong>
              <small>Total de reacciones disponibles</small>
            </div>

            <div className="analytics-card">
              <span>Comentarios</span>
              <strong>{totalComments}</strong>
              <small>Total de comentarios disponibles</small>
            </div>

            <div className="analytics-card">
              <span>Compartidos</span>
              <strong>{totalShares}</strong>
              <small>Total de veces compartido</small>
            </div>
          </div>

          {unavailableCount > 0 && (
            <p className="analytics-warning">
              ⚠️ {unavailableCount} publicaciones sin métricas disponibles.
              Pueden haber sido eliminadas de Facebook o tener restricciones de
              acceso.
            </p>
          )}
        </>
      )}
    </section>
  );
}
