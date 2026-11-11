import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type FC } from "react";
import AnalyticsPage from "./components/AnalyticsPage";
import ApprovalPage from "./components/ApprovalPage";
import AuthPage from "./components/AuthPage";
import BusinessForm from "./components/BusinessForm";
import ContentPage from "./components/ContentPage";
import CampaignsPage from "./components/CampaignsPage";
import DashboardOverview from "./components/DashboardOverview";
import FacebookConnection from "./components/FacebookConnection";
import TikTokConnection from "./components/TikTokConnection";
import SettingsPage from "./components/SettingsPage";
import type { Section } from "./components/Sidebar";
import type { Business } from "./services/businessesApi";
import type { Draft } from "./services/draftsApi";
import { useDraftCollection } from "./features/drafts/hooks/useDraftCollection";
import { useDraftOperations } from "./features/drafts/hooks/useDraftOperations";
import { useDraftActions } from "./features/drafts/hooks/useDraftActions";
import { useApprovalActions } from "./features/approvals/hooks/useApprovalActions";
import { useHeyGenGeneration } from "./features/media/hooks/useHeyGenGeneration";
import { useDraftMedia } from "./features/media/hooks/useDraftMedia";
import { getConnectedFacebookAccounts } from "./services/facebookApi";
import AppShell from "./app/AppShell";
import { useAuthSession } from "./app/useAuthSession";
import { useBusinessSelection } from "./app/useBusinessSelection";
import SofiaChat from "./components/SofiaChat";

function formatDraftDate(value: string): string {
  if (!value) return "Fecha no disponible";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "Fecha no disponible";
  }
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getUserDisplayName(session: Session): string {
  const metadata = session.user.user_metadata ?? {};
  const name = [
    metadata.display_name,
    metadata.full_name,
    metadata.name,
  ].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  return name?.trim() || "Mi cuenta";
}

const App: FC = () => {
  const {
    session,
    checkingAuth,
    isRecoveringPassword,
    completeRecovery,
    signOut,
    updateDisplayName,
  } = useAuthSession();
  if (checkingAuth) return <div className="auth-loading">Cargando...</div>;
  if (!session) return <AuthPage />;
  // A different account gets a fresh workspace; late callbacks cannot reach it.
  return (
    <AuthenticatedApp
      key={session.user.id}
      session={session}
      onSignOut={signOut}
      isRecoveringPassword={isRecoveringPassword}
      onRecoveryComplete={completeRecovery}
      onSaveDisplayName={updateDisplayName}
    />
  );
};

function AuthenticatedApp({
  session,
  onSignOut,
  isRecoveringPassword,
  onRecoveryComplete,
  onSaveDisplayName,
}: {
  session: Session;
  onSignOut: () => Promise<unknown>;
  isRecoveringPassword: boolean;
  onRecoveryComplete: () => void;
  onSaveDisplayName: (displayName: string) => Promise<string>;
}) {
  const [activeSection, setActiveSection] = useState<Section>(() => {
    try {
      const saved = window.localStorage.getItem("ai-marketing-studio:section");
      const validSections: Section[] = [
        "Resumen",
        "Campañas",
        "Contenido",
        "Equipo IA",
        "Aprobaciones",
        "Analíticas",
        "Configuración",
      ];
      return validSections.find((section) => section === saved) ?? "Resumen";
    } catch {
      return "Resumen";
    }
  });
  const {
    businesses,
    selectedBusinessId,
    setSelectedBusinessId,
    businessError,
    addBusiness,
  } = useBusinessSelection(session.user.id);

  type FacebookConnectionStatus = "connected" | "disconnected" | "error";

  const [facebookConnection, setFacebookConnection] = useState<{
    businessId: string;
    status: FacebookConnectionStatus;
  } | null>(null);

  const facebookConnectionStatus =
    facebookConnection?.businessId === selectedBusinessId
      ? facebookConnection.status
      : "loading";

  useEffect(() => {
    if (!session?.user.id || !selectedBusinessId) return;

    let active = true;

    async function checkFacebookConnection() {
      try {
        const accounts = await getConnectedFacebookAccounts(selectedBusinessId);

        if (active) {
          setFacebookConnection({
            businessId: selectedBusinessId,
            status: accounts.length > 0 ? "connected" : "disconnected",
          });
        }
      } catch {
        if (active) {
          setFacebookConnection({
            businessId: selectedBusinessId,
            status: "error",
          });
        }
      }
    }

    void checkFacebookConnection();

    return () => {
      active = false;
    };
  }, [session?.user.id, selectedBusinessId]);
  // Save navigation locally; business selection is saved separately per user.
  useEffect(() => {
    try {
      window.localStorage.setItem("ai-marketing-studio:section", activeSection);
    } catch {
      // The application still works when browser storage is unavailable.
    }
  }, [activeSection]);
  const [showBusinessForm, setShowBusinessForm] = useState(false);

  // These hooks share one collection and lock owner for the authenticated workspace.
  // Keep them above the recovery return so pending work and edits survive recovery.
  const collection = useDraftCollection(selectedBusinessId, session.user.id);
  const operations = useDraftOperations(selectedBusinessId);
  const draftActions = useDraftActions(
    selectedBusinessId,
    collection,
    operations,
    setActiveSection,
  );
  const approvalActions = useApprovalActions(
    selectedBusinessId,
    collection,
    operations,
  );
  const media = useDraftMedia(selectedBusinessId, collection, operations);
  const heygen = useHeyGenGeneration(selectedBusinessId, collection, operations);
  const {
    setApprovals,
    loadingDrafts,
    loadError,
    historyDrafts,
    visibleDrafts,
    pendingCount,
    isCurrentBusiness,
  } = collection;
  const { approvalError, approvingIds, publishingIds, busyDraftIds } =
    operations;
  const {
    generating,
    generationError,
    editingId,
    editTitle,
    editCaption,
    setEditTitle,
    setEditCaption,
    setEditingId,
    deletingIds,
    handleGenerateContent,
    startEditing,
    handleSaveEdit,
    handleDelete,
    handleReject,
  } = draftActions;
  const {
    draftDestinations,
    setDraftDestinations,
    publishError,
    handleApprove,
    handlePublishTikTok,
    handlePublishFacebook,
    handleVerifyTikTok,
    handleVerifyFacebookVideo,
  } = approvalActions;
  const {
    imageUrls,
    imageBusyIds,
    imageErrors,
    imageInstructions,
    showImageEditor,
    updateImageInstructions,
    addImageSuggestion,
    revisions,
    revisionBusyIds,
    revisionErrors,
    toggleImageEditor,
    handleGenerateImage,
    handlePreviewImage,
    refreshRevision,
    handleCreateRevision,
    handleDecideRevision,
  } = media;
  const hasAiActivity =
    !loadingDrafts &&
    !loadError &&
    visibleDrafts.some((draft) => draft.source === "ai");
  const agents = [
    {
      name: "Sofía",
      role: "Estratega de marketing",
      state:
        loadingDrafts || loadError
          ? "Sin verificar"
          : hasAiActivity
            ? "Contenido generado"
            : "Sin actividad registrada",
      activity: loadingDrafts
        ? "Consultando actividad..."
        : loadError
          ? "No se pudo consultar la actividad"
          : hasAiActivity
            ? "Estrategia utilizada en contenido generado por IA"
            : "No hay generaciones de IA registradas para este negocio",
    },
    {
      name: "Leo",
      role: "Creador de contenido",
      state:
        loadingDrafts || loadError
          ? "Sin verificar"
          : hasAiActivity
            ? "Contenido generado"
            : "Sin actividad registrada",
      activity: loadingDrafts
        ? "Consultando actividad..."
        : loadError
          ? "No se pudo consultar la actividad"
          : hasAiActivity
            ? "Publicación creada por IA y guardada como borrador"
            : "No hay generaciones de IA registradas para este negocio",
    },
    {
      name: "Mía",
      role: "Analista de marketing",
      state:
        facebookConnectionStatus === "connected"
          ? "Disponible"
          : facebookConnectionStatus === "disconnected"
            ? "Pendiente"
            : "Sin verificar",
      activity:
        facebookConnectionStatus === "connected"
          ? "Análisis de interacciones de Facebook disponible"
          : facebookConnectionStatus === "disconnected"
            ? "Conecta una página de Facebook para consultar estadísticas"
            : facebookConnectionStatus === "loading"
              ? "Verificando conexión de Facebook..."
              : "No se pudo verificar la conexión de Facebook",
    },
  ];
  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    setShowBusinessForm(false);
  };
  const handleBusinessCreated = (business: Business) => {
    addBusiness(business);
    setShowBusinessForm(false);
  };
  const draftMessages = (
    <>
      {loadingDrafts && (
        <p className="empty-state" role="status">
          Cargando borradores...
        </p>
      )}
      {loadError && (
        <p className="empty-state" role="alert">
          {loadError}
        </p>
      )}
      {approvalError && (
        <p className="empty-state" role="alert">
          {approvalError}
        </p>
      )}
      {publishError && (
        <p className="empty-state" role="alert">
          {publishError}
        </p>
      )}
    </>
  );
  // Keep workspace state and operation locks alive for same-account recovery.
  // Only its rendered page changes; the user-keyed owner still resets on logout
  // or account changes. No workspace content remains rendered during recovery.
  if (isRecoveringPassword) {
    return <AuthPage recoveryMode onRecoveryComplete={onRecoveryComplete} />;
  }
  return (
    <AppShell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      pendingCount={pendingCount}
      businesses={businesses}
      selectedBusinessId={selectedBusinessId}
      onBusinessChange={setSelectedBusinessId}
      onAddBusiness={() => setShowBusinessForm(true)}
      onSignOut={onSignOut}
      businessError={businessError}
      userDisplayName={getUserDisplayName(session)}
      userEmail={session.user.email ?? ""}
    >
      {showBusinessForm ? (
        <BusinessForm
          onCreated={handleBusinessCreated}
          onCancel={() => setShowBusinessForm(false)}
        />
      ) : activeSection === "Resumen" ? (
        <DashboardOverview
          key={selectedBusinessId}
          selectedBusinessId={selectedBusinessId}
          generating={generating}
          generationError={generationError}
          loadingDrafts={loadingDrafts}
          loadError={loadError}
          visibleDrafts={historyDrafts}
          pendingCount={pendingCount}
          agents={agents}
          userDisplayName={getUserDisplayName(session)}
          draftMessages={draftMessages}
          approvingIds={approvingIds}
          busyDraftIds={busyDraftIds}
          imageBusyIds={imageBusyIds}
          editingId={editingId}
          formatDraftDate={formatDraftDate}
          handleGenerateContent={handleGenerateContent}
          handleApprove={handleApprove}
          handleReject={handleReject}
          startEditing={startEditing}
          setActiveSection={setActiveSection}
        />
      ) : activeSection === "Campañas" ? (
        <CampaignsPage
          key={selectedBusinessId}
          businessId={selectedBusinessId}
        />
      ) : activeSection === "Contenido" ? (
        <ContentPage
          key={selectedBusinessId}
          drafts={historyDrafts}
          loading={loadingDrafts}
          error={loadError}
        />
      ) : activeSection === "Analíticas" ? (
        <AnalyticsPage
          key={selectedBusinessId}
          drafts={historyDrafts}
          loading={loadingDrafts}
          error={loadError}
        />
      ) : activeSection === "Aprobaciones" ? (
        <ApprovalPage
          heygen={heygen}
          handleDelete={handleDelete}
          deletingIds={deletingIds}
          businessId={selectedBusinessId}
          loadingDrafts={loadingDrafts}
          loadError={loadError}
          pendingCount={pendingCount}
          draftMessages={draftMessages}
          visibleDrafts={visibleDrafts}
          draftDestinations={draftDestinations}
          setDraftDestinations={setDraftDestinations}
          approvingIds={approvingIds}
          publishingIds={publishingIds}
          busyDraftIds={busyDraftIds}
          editingId={editingId}
          editTitle={editTitle}
          editCaption={editCaption}
          setEditTitle={setEditTitle}
          setEditCaption={setEditCaption}
          setEditingId={setEditingId}
          imageUrls={imageUrls}
          imageBusyIds={imageBusyIds}
          imageErrors={imageErrors}
          imageInstructions={imageInstructions}
          showImageEditor={showImageEditor}
          revisions={revisions}
          revisionBusyIds={revisionBusyIds}
          revisionErrors={revisionErrors}
          formatDraftDate={formatDraftDate}
          handleApprove={handleApprove}
          handlePublishFacebook={handlePublishFacebook}
          onVerifyFacebookVideo={handleVerifyFacebookVideo}
          handlePublishTikTok={handlePublishTikTok}
          onVerifyTikTok={handleVerifyTikTok}
          handleReject={handleReject}
          handleSaveEdit={handleSaveEdit}
          handleGenerateImage={handleGenerateImage}
          handlePreviewImage={handlePreviewImage}
          handleCreateRevision={handleCreateRevision}
          handleDecideRevision={handleDecideRevision}
          refreshRevision={refreshRevision}
          addImageSuggestion={addImageSuggestion}
          updateImageInstructions={updateImageInstructions}
          toggleImageEditor={toggleImageEditor}
          startEditing={startEditing}
        />
      ) : activeSection === "Equipo IA" ? (
        <div className="ai-team-workspace">
          <section className="page-intro">
            <div>
              <span className="eyebrow">Planifica y crea</span>
              <h2>Tu equipo de marketing con IA</h2>
              <p>
                Sofía define la estrategia, Leo convierte el plan en contenido
                y Mía analiza las métricas disponibles.
              </p>
            </div>
          </section>
          <section className="ai-team-roles" aria-label="Roles del equipo IA">
            {agents.map((agent) => (
              <article className="ai-team-role" key={agent.name}>
                <span className="ai-team-role__avatar" aria-hidden="true">
                  {agent.name[0]}
                </span>
                <div>
                  <h3>{agent.name}</h3>
                  <p>{agent.role}</p>
                </div>
              </article>
            ))}
          </section>
          {selectedBusinessId && (
            <SofiaChat
              key={selectedBusinessId}
              businessId={selectedBusinessId}
              onDraftCreated={(draft) => {
                if (!isCurrentBusiness()) return;
                setApprovals((current) => [draft as Draft, ...current]);
                setActiveSection("Aprobaciones");
              }}
            />
          )}

          <section className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Automatización</span>
                <h2>Actividad del Equipo IA</h2>
              </div>
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
                        ["Contenido generado", "Disponible"].includes(
                          agent.state,
                        )
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
          </section>
        </div>
      ) : activeSection === "Configuración" ? (
        <SettingsPage
          businessId={selectedBusinessId}
          userDisplayName={getUserDisplayName(session)}
          userEmail={session.user.email ?? ""}
          onSaveDisplayName={onSaveDisplayName}
          facebookConnection={<FacebookConnection businessId={selectedBusinessId} />}
          tiktokConnection={<TikTokConnection businessId={selectedBusinessId} />}
        />
      ) : (
        <section className="panel placeholder-panel">
          <div className="placeholder-icon">✦</div>
          <h2>{activeSection}</h2>
          <p>
            Esta sección está lista para que empieces a trabajar. Selecciona
            otra opción para volver al resumen.
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => setActiveSection("Resumen")}
          >
            Volver al resumen
          </button>
        </section>
      )}
    </AppShell>
  );
}
export default App;
