import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { getFacebookReach, type Draft } from "../services/draftsApi";
import { getCampaigns, type Campaign } from "../services/campaignsApi";
import type { Section } from "./Sidebar";

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
  userDisplayName: string;
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
  userDisplayName,
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
  const [campaignResult, setCampaignResult] = useState<{
    businessId: string;
    campaigns: Campaign[];
    error: string | null;
  } | null>(null);
  const [reachResult, setReachResult] = useState<{
    requestKey: string;
    uniqueMediaViews: number | null;
    unavailableCount: number;
  } | null>(null);
  const currentCampaignResult =
    campaignResult?.businessId === selectedBusinessId
      ? campaignResult
      : null;
  const campaigns = currentCampaignResult?.campaigns ?? [];
  const campaignsLoading = Boolean(selectedBusinessId) && !currentCampaignResult;
  const campaignsError = currentCampaignResult?.error ?? null;

  useEffect(() => {
    let active = true;
    if (!selectedBusinessId) return () => {
      active = false;
    };

    void getCampaigns(selectedBusinessId)
      .then((items) => {
        if (active)
          setCampaignResult({
            businessId: selectedBusinessId,
            campaigns: items,
            error: null,
          });
      })
      .catch(() => {
        if (active)
          setCampaignResult({
            businessId: selectedBusinessId,
            campaigns: [],
            error: "No se pudieron cargar las campañas.",
          });
      });

    return () => {
      active = false;
    };
  }, [selectedBusinessId]);

  const publishedFacebookDrafts = useMemo(
    () =>
      visibleDrafts.filter(
        (draft) =>
          !draft.deleted_at &&
          draft.business_id === selectedBusinessId &&
          draft.facebook_publish_status === "published" &&
          Boolean(draft.facebook_post_id),
      ),
    [visibleDrafts, selectedBusinessId],
  );
  const reachRequestKey = JSON.stringify([
    selectedBusinessId,
    publishedFacebookDrafts.map((draft) => draft.id),
  ]);
  const shouldLoadReach =
    !loadingDrafts && !loadError && publishedFacebookDrafts.length > 0;
  const currentReachResult =
    reachResult?.requestKey === reachRequestKey ? reachResult : null;
  const uniqueMediaViews = currentReachResult?.uniqueMediaViews ?? null;
  const unavailableReachCount = currentReachResult?.unavailableCount ?? 0;
  const reachLoading = shouldLoadReach && !currentReachResult;

  useEffect(() => {
    let cancelled = false;
    if (!shouldLoadReach) return () => {
      cancelled = true;
    };

    void Promise.allSettled(
      publishedFacebookDrafts.map((draft) => getFacebookReach(draft.id)),
    ).then((results) => {
      if (cancelled) return;
      const available = results.flatMap((result) =>
        result.status === "fulfilled" &&
        result.value.unique_media_viewers !== null
          ? [result.value.unique_media_viewers]
          : [],
      );
      setReachResult({
        requestKey: reachRequestKey,
        uniqueMediaViews: available.length
          ? available.reduce((total, value) => total + value, 0)
          : null,
        unavailableCount: results.length - available.length,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [publishedFacebookDrafts, reachRequestKey, shouldLoadReach]);

  const activeCampaigns = campaigns.filter(
    (campaign) => campaign.status === "active",
  );
  const drafts = visibleDrafts.filter((draft) => !draft.deleted_at);
  const recentPosts = drafts
    .filter(
      (draft) =>
        (draft.facebook_publish_status === "published" ||
          draft.tiktok_publish_status === "published") &&
        draft.published_at,
    )
    .sort(
      (a, b) =>
        new Date(b.published_at ?? "").getTime() -
        new Date(a.published_at ?? "").getTime(),
    )
    .slice(0, 4);
  const pendingDrafts = drafts
    .filter((draft) => draft.status === "pending")
    .slice(0, 3);

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero__copy">
          <span className="dashboard-kicker">
            <Sparkles size={15} aria-hidden="true" />
            Tu espacio creativo
          </span>
          <h2>Hola, {userDisplayName}</h2>
          <p>
            Sigue tu trabajo y continúa con el siguiente paso de tu marketing.
          </p>
        </div>
        <button
          className="dashboard-hero__action"
          type="button"
          onClick={() => void handleGenerateContent()}
          disabled={!selectedBusinessId || generating}
        >
          <FilePlus2 size={18} aria-hidden="true" />
          {generating ? "Preparando contenido…" : "Crear contenido"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        {generationError && (
          <p className="dashboard-message dashboard-message--error" role="alert">
            {generationError}
          </p>
        )}
      </section>

      <section className="workflow-steps" aria-label="Flujo de trabajo">
        {[
          ["Planifica", "Campañas", "Campañas"],
          ["Crea", "Equipo IA", "Equipo IA"],
          ["Revisa", "Aprobaciones", "Aprobaciones"],
          ["Analiza", "Resultados", "Analíticas"],
        ].map(([label, hint, section], index) => (
          <button
            type="button"
            className="workflow-step"
            key={label}
            onClick={() => setActiveSection(section as Section)}
          >
            <span className="workflow-step__number">{index + 1}</span>
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
            {index < 3 && (
              <ArrowRight className="workflow-step__arrow" size={16} aria-hidden="true" />
            )}
          </button>
        ))}
      </section>

      <section className="dashboard-kpis" aria-label="Actividad del negocio">
        <article className="dashboard-kpi">
          <span className="dashboard-kpi__icon dashboard-kpi__icon--violet">
            <Megaphone size={18} aria-hidden="true" />
          </span>
          <span className="dashboard-kpi__label">Campañas activas</span>
          <strong>
            {campaignsLoading || campaignsError ? "—" : activeCampaigns.length}
          </strong>
          <small>{campaignsError ?? "De este negocio"}</small>
        </article>
        <article className="dashboard-kpi">
          <span className="dashboard-kpi__icon dashboard-kpi__icon--blue">
            <FilePlus2 size={18} aria-hidden="true" />
          </span>
          <span className="dashboard-kpi__label">Contenido en biblioteca</span>
          <strong>{loadingDrafts || loadError ? "—" : drafts.length}</strong>
          <small>{loadError ?? "Borradores e historial"}</small>
        </article>
        <article className="dashboard-kpi">
          <span className="dashboard-kpi__icon dashboard-kpi__icon--amber">
            <Clock3 size={18} aria-hidden="true" />
          </span>
          <span className="dashboard-kpi__label">Por revisar</span>
          <strong>{loadingDrafts || loadError ? "—" : pendingCount}</strong>
          <small>{loadError ?? "Esperando tu aprobación"}</small>
        </article>
        <article className="dashboard-kpi">
          <span className="dashboard-kpi__icon dashboard-kpi__icon--green">
            <BarChart3 size={18} aria-hidden="true" />
          </span>
          <span className="dashboard-kpi__label">Espectadores únicos</span>
          <strong>
            {reachLoading
              ? "…"
              : uniqueMediaViews === null
                ? "—"
                : uniqueMediaViews.toLocaleString("es")}
          </strong>
          <small>
            {unavailableReachCount > 0
              ? `${unavailableReachCount} publicaciones sin dato disponible`
              : "Métricas disponibles de Facebook"}
          </small>
        </article>
      </section>

      <section className="dashboard-panels">
        <article className="workspace-card dashboard-campaigns">
          <header className="workspace-card__header">
            <div>
              <span className="eyebrow">Planifica</span>
              <h3>Campañas</h3>
            </div>
            <button
              type="button"
              className="quiet-link"
              onClick={() => setActiveSection("Campañas")}
            >
              Ver campañas <ArrowRight size={15} aria-hidden="true" />
            </button>
          </header>
          {campaignsLoading ? (
            <p className="workspace-state" role="status">Cargando campañas…</p>
          ) : campaignsError ? (
            <p className="workspace-state workspace-state--error" role="alert">
              {campaignsError}
            </p>
          ) : campaigns.length ? (
            <div className="dashboard-campaign-list">
              {campaigns.slice(0, 3).map((campaign) => (
                <div className="dashboard-campaign" key={campaign.id}>
                  <div className="dashboard-campaign__top">
                    <strong>{campaign.name}</strong>
                    <span className={`status-pill status-pill--${campaign.status}`}>
                      {campaign.status === "active"
                        ? "Activa"
                        : campaign.status === "paused"
                          ? "Pausada"
                          : campaign.status === "completed"
                            ? "Completada"
                            : campaign.status === "archived"
                              ? "Archivada"
                              : "Borrador"}
                    </span>
                  </div>
                  <p>{campaign.objective}</p>
                  <div className="dashboard-progress">
                    <span style={{ width: `${campaign.progress}%` }} />
                  </div>
                  <small>
                    {campaign.published_count} de {campaign.total_count} piezas
                    publicadas · {campaign.progress}%
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <div className="workspace-empty">
              <span className="workspace-empty__icon"><Megaphone size={20} /></span>
              <strong>Tu primera campaña empieza aquí</strong>
              <p>Define un objetivo y organiza el contenido de tu negocio.</p>
              <button type="button" className="quiet-link" onClick={() => setActiveSection("Campañas")}>
                Crear campaña <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </article>

        <article className="workspace-card dashboard-approvals">
          <header className="workspace-card__header">
            <div>
              <span className="eyebrow">Revisión</span>
              <h3>Necesitan tu atención</h3>
            </div>
            <span className="dashboard-count">{pendingCount}</span>
          </header>
          {draftMessages}
          {!loadingDrafts && !loadError && pendingDrafts.length ? (
            <div className="dashboard-approval-list">
              {pendingDrafts.map((draft) => (
                <article className="dashboard-approval" key={draft.id}>
                  <div>
                    <span className="dashboard-approval__platform">
                      {draft.platform}
                    </span>
                    <h4>{draft.title}</h4>
                    <p>{draft.caption}</p>
                    <small>{formatDraftDate(draft.created_at)}</small>
                  </div>
                  <div className="dashboard-approval__actions">
                    <button
                      type="button"
                      className="dashboard-approval__review"
                      onClick={() => startEditing(draft)}
                      disabled={
                        busyDraftIds.includes(draft.id) ||
                        approvingIds.includes(draft.id) ||
                        editingId === draft.id
                      }
                    >
                      Revisar
                    </button>
                    <button
                      type="button"
                      className="dashboard-approval__approve"
                      onClick={() => void handleApprove(draft.id)}
                      disabled={
                        approvingIds.includes(draft.id) ||
                        busyDraftIds.includes(draft.id) ||
                        imageBusyIds.includes(draft.id) ||
                        editingId === draft.id
                      }
                    >
                      <CheckCircle2 size={15} aria-hidden="true" />
                      {approvingIds.includes(draft.id) ? "Aprobando…" : "Aprobar"}
                    </button>
                    <button
                      type="button"
                      className="dashboard-approval__reject"
                      onClick={() => void handleReject(draft.id)}
                      disabled={
                        busyDraftIds.includes(draft.id) ||
                        approvingIds.includes(draft.id) ||
                        imageBusyIds.includes(draft.id) ||
                        editingId === draft.id
                      }
                    >
                      Rechazar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : !loadingDrafts && !loadError ? (
            <div className="workspace-empty workspace-empty--compact">
              <CheckCircle2 size={22} aria-hidden="true" />
              <strong>No hay aprobaciones pendientes</strong>
              <p>Tu bandeja está al día.</p>
            </div>
          ) : null}
          <button
            type="button"
            className="quiet-link dashboard-section-link"
            onClick={() => setActiveSection("Aprobaciones")}
          >
            Abrir bandeja <ArrowRight size={15} aria-hidden="true" />
          </button>
        </article>

        <article className="workspace-card dashboard-publications">
          <header className="workspace-card__header">
            <div>
              <span className="eyebrow">Publicado</span>
              <h3>Actividad reciente</h3>
            </div>
            <button
              type="button"
              className="quiet-link"
              onClick={() => setActiveSection("Contenido")}
            >
              Ver contenido <ArrowRight size={15} aria-hidden="true" />
            </button>
          </header>
          {recentPosts.length ? (
            <div className="dashboard-publication-list">
              {recentPosts.map((draft) => (
                <article className="dashboard-publication" key={draft.id}>
                  <span className="dashboard-publication__platform">
                    {draft.facebook_publish_status === "published"
                      ? "f"
                      : "♪"}
                  </span>
                  <div>
                    <strong>{draft.title}</strong>
                    <p>
                      {draft.facebook_publish_status === "published"
                        ? "Facebook"
                        : "TikTok"}{" "}
                      · {formatDraftDate(draft.published_at ?? "")}
                    </p>
                  </div>
                  <CheckCircle2 size={17} aria-label="Publicado" />
                </article>
              ))}
            </div>
          ) : (
            <div className="workspace-empty workspace-empty--compact">
              <p>
                Las publicaciones aparecerán aquí después de confirmar su
                publicación.
              </p>
            </div>
          )}
        </article>

        <article className="workspace-card dashboard-team">
          <header className="workspace-card__header">
            <div>
              <span className="eyebrow">Tu equipo de IA</span>
              <h3>Roles y actividad</h3>
            </div>
            <button
              type="button"
              className="quiet-link"
              onClick={() => setActiveSection("Equipo IA")}
            >
              Ir al equipo <ArrowRight size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="dashboard-agent-list">
            {agents.map((agent) => (
              <div className="dashboard-agent" key={agent.name}>
                <span aria-hidden="true">{agent.name[0]}</span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                  <p>{agent.activity}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
};

export default DashboardOverview;
