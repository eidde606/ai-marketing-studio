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

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      setAnalytics([]);

      try {
        const results = await Promise.all(
          publishedDrafts.map((draft) => getFacebookAnalytics(draft.id)),
        );

        if (!cancelled) {
          setAnalytics(results);
        }
      } catch {
        if (!cancelled) {
          setAnalyticsError("No se pudieron cargar las métricas de Facebook.");
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
      <h2>Analíticas de Facebook</h2>
      <p>Rendimiento de las publicaciones de este negocio.</p>

      <div className="analytics-summary">
        <h3>Publicaciones realizadas</h3>
        <p>{publishedDrafts.length}</p>

        {analyticsLoading ? (
          <p>Cargando métricas de Facebook...</p>
        ) : analyticsError ? (
          <p>{analyticsError}</p>
        ) : (
          <>
            <h3>Reacciones</h3>
            <p>{totalReactions}</p>

            <h3>Comentarios</h3>
            <p>{totalComments}</p>

            <h3>Compartidos</h3>
            <p>{totalShares}</p>
          </>
        )}
      </div>
    </section>
  );
}
