import { useEffect, useMemo, useState } from "react";
import { BarChart3, MessageCircle, Share2, ThumbsUp } from "lucide-react";
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

function metricValue(value: number, hasData: boolean): string {
  return hasData ? value.toLocaleString("es") : "—";
}

export default function AnalyticsPage({ drafts, loading, error }: Props) {
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
    message: string;
  } | null>(null);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${JSON.stringify(publishedDrafts.map((draft) => draft.id))}:${retryCount}`;
  const analyticsLoading = completedRequestKey !== requestKey;
  const analyticsError =
    analyticsFailure?.requestKey === requestKey
      ? analyticsFailure.message
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
            message: "No se pudieron procesar las analíticas.",
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
        <p className="workspace-state" role="status">Cargando contenido…</p>
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
          <span className="eyebrow">Mide lo que importa</span>
          <h2>Analíticas</h2>
          <p>Resultados disponibles de las publicaciones de este negocio.</p>
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
          {analyticsLoading ? "Actualizando…" : "Actualizar métricas"}
        </button>
      </section>

      <section className="analytics-source-note" role="note">
        <span className="analytics-source-note__icon">
          <BarChart3 size={18} aria-hidden="true" />
        </span>
        <p>
          Los datos disponibles aquí son métricas de Facebook. No se muestran
          tendencias ni métricas de TikTok porque no están disponibles en esta
          vista.
        </p>
      </section>

      {analyticsLoading ? (
        <p className="workspace-state" role="status">Consultando métricas de Facebook…</p>
      ) : analyticsError ? (
        <p className="workspace-state workspace-state--error" role="alert">{analyticsError}</p>
      ) : (
        <>
          <section className="analytics-metrics" aria-label="Métricas de Facebook">
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--violet">
                <BarChart3 size={18} aria-hidden="true" />
              </span>
              <small>Publicaciones confirmadas</small>
              <strong>{publishedDrafts.length.toLocaleString("es")}</strong>
              <span>Historial de Facebook</span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--blue">
                <ThumbsUp size={18} aria-hidden="true" />
              </span>
              <small>Reacciones</small>
              <strong>{metricValue(totals.reactions, hasMetrics)}</strong>
              <span>{hasMetrics ? "Total de datos accesibles" : "Sin datos disponibles"}</span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--green">
                <MessageCircle size={18} aria-hidden="true" />
              </span>
              <small>Comentarios</small>
              <strong>{metricValue(totals.comments, hasMetrics)}</strong>
              <span>{hasMetrics ? "Total de datos accesibles" : "Sin datos disponibles"}</span>
            </article>
            <article className="analytics-metric">
              <span className="analytics-metric__icon analytics-metric__icon--amber">
                <Share2 size={18} aria-hidden="true" />
              </span>
              <small>Compartidos</small>
              <strong>{metricValue(totals.shares, hasMetrics)}</strong>
              <span>{hasMetrics ? "Total de datos accesibles" : "Sin datos disponibles"}</span>
            </article>
          </section>

          {unavailableCount > 0 && (
            <p className="analytics-warning" role="status">
              {unavailableCount}{" "}
              {unavailableCount === 1
                ? "publicación no tiene métricas disponibles"
                : "publicaciones no tienen métricas disponibles"}
              . Puede deberse a restricciones de acceso o a que se eliminaron en
              Facebook.
            </p>
          )}

          <section className="analytics-posts">
            <header className="analytics-posts__header">
              <div>
                <span className="eyebrow">Detalle</span>
                <h3>Publicaciones analizadas</h3>
              </div>
              <span>{analytics.length} con datos</span>
            </header>
            {publishedDrafts.length === 0 ? (
              <div className="analytics-empty">
                <BarChart3 size={24} aria-hidden="true" />
                <strong>Aún no hay publicaciones de Facebook</strong>
                <p>Las métricas aparecerán cuando haya publicaciones confirmadas.</p>
              </div>
            ) : analytics.length === 0 ? (
              <div className="analytics-empty">
                <strong>No hay métricas disponibles</strong>
                <p>
                  Hay {publishedDrafts.length} publicaciones confirmadas, pero
                  Facebook no devolvió datos accesibles.
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
                        <span>{item.reactions} reacciones</span>
                        <span>{item.comments} comentarios</span>
                        <span>{item.shares} compartidos</span>
                      </div>
                      {item.permalink_url && (
                        <a
                          href={item.permalink_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ver publicación
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
