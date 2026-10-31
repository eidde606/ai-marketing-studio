import { useEffect, useState, type FC, type ReactNode } from "react";
import { getFacebookReach, type Draft } from "../services/draftsApi";
import type { Section } from "./Sidebar";
import SummaryCard from "./SummaryCard";

type Agent = {
  name: string;
  role: string;
  state: string;
  activity: string;
};

type DashboardOverviewProps = {
  selectedBusinessId: string;
  generating: boolean;
  generationError: string | null;
  loadingDrafts: boolean;
  loadError: string | null;
  visibleDrafts: Draft[];
  pendingCount: number;
  agents: Agent[];
  draftMessages: ReactNode;
  approvingIds: string[];
  busyDraftIds: string[];
  imageBusyIds: string[];
  editingId: string | null;
  formatDraftDate: (date: string) => string;
  handleGenerateContent: () => Promise<void>;
  handleApprove: (id: string) => Promise<void>;
  handleReject: (id: string) => Promise<void>;
  startEditing: (draft: Draft) => void;
  setActiveSection: (section: Section) => void;
};

const DashboardOverview: FC<DashboardOverviewProps> = ({
  selectedBusinessId,
  generating,
  generationError,
  loadingDrafts,
  loadError,
  visibleDrafts,
  pendingCount,
  agents,
  draftMessages,
  approvingIds,
  busyDraftIds,
  imageBusyIds,
  editingId,
  formatDraftDate,
  handleGenerateContent,
  handleApprove,
  handleReject,
  startEditing,
  setActiveSection,
}) => {
  const [uniqueMediaViews, setUniqueMediaViews] = useState<number | null>(null);
  const [unavailableReachCount, setUnavailableReachCount] = useState(0);
  const [reachLoading, setReachLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReach() {
      const published = visibleDrafts.filter(
        (draft) =>
          draft.business_id === selectedBusinessId &&
          draft.facebook_publish_status === "published" &&
          draft.facebook_post_id,
      );

      try {
        const results = await Promise.allSettled(
          published.map((draft) => getFacebookReach(draft.id)),
        );

        if (cancelled) return;

        const unavailable = results.filter(
          (result) =>
            result.status === "rejected" ||
            result.value.unique_media_viewers === null,
        ).length;

        setUnavailableReachCount(unavailable);

        const values: number[] = [];

        for (const result of results) {
          if (
            result.status === "fulfilled" &&
            result.value.unique_media_viewers !== null
          ) {
            values.push(result.value.unique_media_viewers);
          }
        }

        setUniqueMediaViews(
          values.length > 0
            ? values.reduce((total, value) => total + value, 0)
            : null,
        );
      } finally {
        if (!cancelled) setReachLoading(false);
      }
    }

    if (!loadingDrafts && !loadError && selectedBusinessId) {
      void loadReach();
    }

    return () => {
      cancelled = true;
    };
  }, [visibleDrafts, selectedBusinessId, loadingDrafts, loadError]);

  const recentPosts = visibleDrafts
    .filter(
      (draft) =>
        draft.facebook_publish_status === "published" &&
        draft.published_at !== null &&
        draft.business_id === selectedBusinessId,
    )
    .sort(
      (a, b) =>
        new Date(b.published_at ?? "").getTime() -
        new Date(a.published_at ?? "").getTime(),
    )
    .slice(0, 5);

  return (
    <>
      <section className="welcome">
        <div>
          <h2>
            Buenos días, Ángela <span>✦</span>
          </h2>

          <p>
            Aquí tienes una visión general de lo que está pasando en tu
            marketing.
          </p>
        </div>

        <button
          className="primary-button"

          type="button"

          onClick={() => void handleGenerateContent()}

          disabled={!selectedBusinessId || generating}
        >
          {generating ? "Generando contenido..." : "＋ Crear contenido"}
        </button>

        {generationError && <p role="alert">{generationError}</p>}
      </section>

      <section
        className="summary-grid"

        aria-label="Resumen de métricas"
      >
        <SummaryCard
          icon="◈"

          label="Campañas activas"

          value="0"

          detail="Aún no hay campañas"

          tone="purple"
        />

        <SummaryCard
          icon="✧"

          label="Contenido generado"

          value={
            loadingDrafts || loadError ? "—" : String(visibleDrafts.length)
          }

          detail="Borradores registrados"

          tone="orange"
        />

        <SummaryCard
          icon="✓"

          label="Aprobaciones pendientes"

          value={loadingDrafts || loadError ? "—" : String(pendingCount)}

          detail="Requieren tu atención"

          tone="blue"
        />

        <SummaryCard
          icon="◒"
          label="Espectadores únicos"
          value={
            reachLoading
              ? "..."
              : uniqueMediaViews === null
                ? "—"
                : String(uniqueMediaViews)
          }
          detail={
            unavailableReachCount > 0
              ? `Datos parciales · ${unavailableReachCount} publicaciones sin métricas`
              : "Suma de espectadores únicos por publicación en Facebook"
          }
          tone="green"
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel campaigns-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Rendimiento</span>

              <h2>Resumen de campañas</h2>
            </div>

            <button
              className="text-button"

              type="button"

              onClick={() => setActiveSection("Campañas")}
            >
              Ver todas →
            </button>
          </div>

          <div className="campaign-list">
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <p style={{ fontWeight: 600 }}>Aún no hay campañas</p>

              <p style={{ color: "#64748b", marginTop: "0.5rem" }}>
                Cuando el equipo IA cree campañas para este negocio, aparecerán
                aquí.
              </p>
            </div>
          </div>
        </article>

        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Automatización</span>

              <h2>Actividad del Equipo IA</h2>
            </div>

            <button
              className="text-button"

              type="button"

              onClick={() => setActiveSection("Equipo IA")}
            >
              Ver equipo →
            </button>
          </div>

          <div className="agent-list">
            {agents.map((agent) => (
              <div className="agent-row" key={agent.name}>
                <div className="agent-avatar">{agent.name[0]}</div>

                <div className="agent-info">
                  <strong>{agent.name}</strong>

                  <span>{agent.role}</span>
                </div>

                <div className="agent-status">
                  <span
                    className={`status-dot ${
                      ["Contenido generado", "Disponible"].includes(agent.state)
                        ? "available"
                        : ""
                    }`}
                  />

                  {agent.state}

                  <small>{agent.activity}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Contenido reciente</span>

              <h2>Publicaciones sociales</h2>
            </div>

            <button
              className="text-button"

              type="button"

              onClick={() => setActiveSection("Contenido")}
            >
              Ver contenido →
            </button>
          </div>

          <div className="post-list">
            {loadingDrafts ? (
              <p className="empty-state">Cargando publicaciones...</p>
            ) : loadError ? (
              <p className="empty-state">
                No se pudieron cargar las publicaciones.
              </p>
            ) : recentPosts.length > 0 ? (
              recentPosts.map((post) => (
                <div className="approval-row" key={post.id}>
                  <div className="approval-content">
                    <strong>{post.title}</strong>

                    <span>
                      Facebook ·{" "}
                      {post.published_at
                        ? formatDraftDate(post.published_at)
                        : "Fecha no disponible"}
                    </span>

                    <span>
                      {post.caption.length > 120
                        ? `${post.caption.slice(0, 120).trimEnd()}...`
                        : post.caption}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <p style={{ fontWeight: 600 }}>Aún no hay publicaciones</p>

                <p style={{ color: "#64748b", marginTop: "0.5rem" }}>
                  Las publicaciones aparecerán aquí cuando sean publicadas en
                  las redes sociales.
                </p>
              </div>
            )}
          </div>
        </article>

        <article className="panel approval-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Tu bandeja</span>

              <h2>Aprobaciones pendientes</h2>
            </div>

            <button
              className="text-button"

              type="button"

              onClick={() => setActiveSection("Aprobaciones")}
            >
              Ver todas →
            </button>
          </div>

          <div className="approval-list">
            {draftMessages}

            {!loadingDrafts &&
              !loadError &&
              visibleDrafts

                .filter((draft) => draft.status === "pending")

                .slice(0, 2)

                .map((draft) => (
                  <div className="approval-row" key={draft.id}>
                    <div className="approval-content">
                      <strong>{draft.title}</strong>

                      <span>
                        {draft.platform} · {formatDraftDate(draft.created_at)}
                      </span>

                      <span>{draft.caption}</span>
                    </div>

                    <div className="approval-actions">
                      <button
                        className="approve-button"

                        type="button"

                        disabled={
                          approvingIds.includes(draft.id) ||
                          busyDraftIds.includes(draft.id) ||
                          imageBusyIds.includes(draft.id) ||
                          editingId === draft.id
                        }

                        onClick={() => void handleApprove(draft.id)}
                      >
                        {approvingIds.includes(draft.id)
                          ? "Aprobando..."
                          : "Aprobar"}
                      </button>

                      <button
                        className="text-button"

                        type="button"

                        disabled={
                          busyDraftIds.includes(draft.id) ||
                          approvingIds.includes(draft.id)
                        }

                        onClick={() => startEditing(draft)}
                      >
                        Editar
                      </button>

                      <button
                        className="reject-button"

                        type="button"

                        disabled={
                          busyDraftIds.includes(draft.id) ||
                          approvingIds.includes(draft.id) ||
                          imageBusyIds.includes(draft.id)
                        }

                        onClick={() => void handleReject(draft.id)}
                      >
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}

            {!loadingDrafts && !loadError && pendingCount === 0 && (
              <p className="empty-state">
                Todo está al día. No hay aprobaciones pendientes.
              </p>
            )}
          </div>
        </article>
      </section>
    </>
  );
};

export default DashboardOverview;
