import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState, type FC } from "react";
import AnalyticsPage from "./components/AnalyticsPage";
import ApprovalPage from "./components/ApprovalPage";
import BillingPage from "./components/BillingPage";
import AuthPage from "./components/AuthPage";
import BusinessForm from "./components/BusinessForm";
import ContentPage from "./components/ContentPage";
import CampaignsPage from "./components/CampaignsPage";
import DashboardOverview from "./components/DashboardOverview";
import FacebookConnection from "./components/FacebookConnection";
import TikTokConnection from "./components/TikTokConnection";
import InstagramConnection from "./components/InstagramConnection";
import SettingsPage from "./components/SettingsPage";
import OnboardingWizard from "./components/OnboardingWizard";
import ProductTutorial from "./components/ProductTutorial";
import { getSectionLabel, type Section } from "./components/Sidebar";
import {
  updateBusiness,
  type Business,
  type BusinessUpdate,
} from "./services/businessesApi";
import type { Draft } from "./services/draftsApi";
import { useDraftCollection } from "./features/drafts/hooks/useDraftCollection";
import { useDraftOperations } from "./features/drafts/hooks/useDraftOperations";
import { useDraftActions } from "./features/drafts/hooks/useDraftActions";
import { useApprovalActions } from "./features/approvals/hooks/useApprovalActions";
import { useHeyGenGeneration } from "./features/media/hooks/useHeyGenGeneration";
import { useDraftMedia } from "./features/media/hooks/useDraftMedia";
import AppShell from "./app/AppShell";
import LanguagePreferences from "./app/LanguagePreferences";
import UsageIndicator from "./app/UsageIndicator";
import TrialStatus from "./app/TrialStatus";
import { useAuthSession } from "./app/useAuthSession";
import { useBusinessSelection } from "./app/useBusinessSelection";
import SofiaChat from "./components/SofiaChat";
import { LocalizationProvider } from "./app/localization";
import { useLocalization } from "./app/useLocalization";
import { ApiError } from "./lib/apiClient";
import {
  getOnboarding,
  updateTutorialCompletion,
} from "./services/onboardingApi";
import { getPublicConfig, registerAccount } from "./services/accountApi";
import {
  clearFacebookOAuthReturn,
  restoreFacebookOAuthReturn,
  type FacebookHandoffContext,
} from "./app/facebookOAuthReturn";
import LegalPages from "./features/legal/LegalPages";
import { resolvePublicLegalPage } from "./features/legal/pagePaths";

function formatDraftDate(value: string, locale: "en" | "es"): string {
  if (!value)
    return locale === "es" ? "Fecha no disponible" : "Date unavailable";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return locale === "es" ? "Fecha no disponible" : "Date unavailable";
  }
  return new Intl.DateTimeFormat(locale === "es" ? "es" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getUserDisplayName(session: Session, fallback: string): string {
  const metadata = session.user.user_metadata ?? {};
  const name = [metadata.display_name, metadata.full_name, metadata.name].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  return name?.trim() || fallback;
}

const App: FC = () => {
  const legalPage = resolvePublicLegalPage(window.location.pathname);
  if (legalPage) {
    return (
      <LocalizationProvider userId={null}>
        <LegalPages page={legalPage} />
      </LocalizationProvider>
    );
  }
  return <AuthenticatedRoot />;
};

function AuthenticatedRoot() {
  const auth = useAuthSession();
  const [facebookOAuthReturn, setFacebookOAuthReturn] = useState(
    restoreFacebookOAuthReturn,
  );
  const clearFacebookReturn = useCallback(() => {
    clearFacebookOAuthReturn();
    setFacebookOAuthReturn({ handoff: null, result: null });
  }, []);
  return (
    <LocalizationProvider userId={auth.session?.user.id ?? null}>
      <AppWorkspace
        auth={auth}
        facebookHandoff={facebookOAuthReturn.handoff}
        facebookCallbackResult={facebookOAuthReturn.result}
        onFacebookReturnResolved={clearFacebookReturn}
      />
    </LocalizationProvider>
  );
}

function AppWorkspace({
  auth,
  facebookHandoff,
  facebookCallbackResult,
  onFacebookReturnResolved,
}: {
  auth: ReturnType<typeof useAuthSession>;
  facebookHandoff: FacebookHandoffContext | null;
  facebookCallbackResult: string | null;
  onFacebookReturnResolved: () => void;
}) {
  const { accountError, accountLoading, refreshAccount, t } = useLocalization();
  const [provisioning, setProvisioning] = useState<
    "idle" | "pending" | "failed"
  >("idle");
  const [provisioningRetry, setProvisioningRetry] = useState(0);
  const provisioningAttempt = useRef<string | null>(null);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const unprovisioned =
    accountError instanceof ApiError && accountError.status === 403;

  useEffect(() => {
    const userId = auth.session?.user.id;
    if (!userId || accountLoading || !unprovisioned) {
      if (!userId) provisioningAttempt.current = null;
      return;
    }
    if (provisioningAttempt.current === userId) return;
    provisioningAttempt.current = userId;
    let active = true;
    setVerificationRequired(false);
    setProvisioning("pending");
    void (async () => {
      try {
        const config = await getPublicConfig();
        if (!config.public_registration) {
          if (active) setProvisioning("idle");
          return;
        }
        await registerAccount();
        await refreshAccount();
        if (active) setProvisioning("idle");
      } catch (error) {
        if (active) {
          setVerificationRequired(
            error instanceof ApiError && error.status === 403,
          );
          setProvisioning("failed");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    accountLoading,
    auth.session?.user.id,
    provisioningRetry,
    refreshAccount,
    unprovisioned,
  ]);

  if (auth.checkingAuth) {
    return <div className="auth-loading">{t("common.loading")}</div>;
  }
  if (!auth.session) return <AuthPage />;
  if (provisioning === "pending") {
    return (
      <main className="workspace-access-state">
        <p role="status">{t("registration.provisioning")}</p>
      </main>
    );
  }
  if (provisioning === "failed") {
    return (
      <main className="workspace-access-state">
        <section className="panel" role="alert">
          <h1>{t("registration.provisioningFailed")}</h1>
          <p>
            {verificationRequired
              ? t("registration.verifyEmail")
              : t("registration.provisioningHelp")}
          </p>
          <div className="workspace-access-state__actions">
            <button
              type="button"
              onClick={() => {
                provisioningAttempt.current = null;
                setVerificationRequired(false);
                setProvisioning("idle");
                setProvisioningRetry((value) => value + 1);
              }}
            >
              {t("common.retry")}
            </button>
            <button type="button" onClick={() => void auth.signOut()}>
              {t("shell.signOut")}
            </button>
          </div>
        </section>
      </main>
    );
  }
  return (
    <AuthenticatedApp
      key={auth.session.user.id}
      session={auth.session}
      facebookHandoff={facebookHandoff}
      facebookCallbackResult={facebookCallbackResult}
      onFacebookReturnResolved={onFacebookReturnResolved}
      onSignOut={auth.signOut}
      isRecoveringPassword={auth.isRecoveringPassword}
      onRecoveryComplete={auth.completeRecovery}
      onSaveDisplayName={auth.updateDisplayName}
    />
  );
}

function WorkspaceAccessState({
  denied,
  loading,
  onRetry,
  onSignOut,
}: {
  denied: boolean;
  loading: boolean;
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<unknown>;
}) {
  const { t } = useLocalization();
  return (
    <main className="workspace-access-state" aria-labelledby="access-heading">
      <section className="panel" role={denied ? "alert" : "status"}>
        <h1 id="access-heading">
          {denied ? t("app.accessUnavailable") : t("app.starting")}
        </h1>
        <p>{denied ? t("app.accountNotProvisioned") : t("app.accessRetry")}</p>
        <div className="workspace-access-state__actions">
          {denied ? (
            <button type="button" onClick={() => void onSignOut()}>
              {t("app.signOutAndRetry")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={loading}
            >
              {loading ? t("app.accessRetrying") : t("common.retry")}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthenticatedApp({
  session,
  facebookHandoff,
  facebookCallbackResult,
  onFacebookReturnResolved,
  onSignOut,
  isRecoveringPassword,
  onRecoveryComplete,
  onSaveDisplayName,
}: {
  session: Session;
  facebookHandoff: FacebookHandoffContext | null;
  facebookCallbackResult: string | null;
  onFacebookReturnResolved: () => void;
  onSignOut: () => Promise<unknown>;
  isRecoveringPassword: boolean;
  onRecoveryComplete: () => void;
  onSaveDisplayName: (displayName: string) => Promise<string>;
}) {
  const { account, accountLoading, accountError, refreshAccount, locale, t } =
    useLocalization();
  const userDisplayName = getUserDisplayName(session, t("shell.myAccount"));
  const [activeSection, setActiveSection] = useState<Section>(() => {
    if (facebookHandoff || facebookCallbackResult) return "Configuración";
    try {
      const saved = window.localStorage.getItem("ai-marketing-studio:section");
      const validSections: Section[] = [
        "Resumen",
        "Campañas",
        "Contenido",
        "Equipo IA",
        "Aprobaciones",
        "Analíticas",
        "Facturación",
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
    businessLoading,
    refreshBusinesses,
    addBusiness,
  } = useBusinessSelection(
    session.user.id,
    facebookHandoff?.businessId ?? null,
  );
  const [sofiaDrafts, setSofiaDrafts] = useState<Record<string, string>>({});
  const updateSofiaDraft = useCallback(
    (message: string) => {
      if (!selectedBusinessId) return;
      setSofiaDrafts((current) => ({
        ...current,
        [selectedBusinessId]: message,
      }));
    },
    [selectedBusinessId],
  );

  // Save navigation locally; business selection is saved separately per user.
  useEffect(() => {
    try {
      window.localStorage.setItem("ai-marketing-studio:section", activeSection);
    } catch {
      // The application still works when browser storage is unavailable.
    }
  }, [activeSection]);
  const [showBusinessForm, setShowBusinessForm] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialLoadError, setTutorialLoadError] = useState(false);
  const [tutorialRetry, setTutorialRetry] = useState(0);
  const [strategyHandoff, setStrategyHandoff] = useState<{
    businessId: string;
    message: string;
  } | null>(null);

  const clearStrategyHandoff = useCallback(() => setStrategyHandoff(null), []);
  const refreshBusinessesAndClearHandoff = useCallback(async () => {
    setStrategyHandoff(null);
    await refreshBusinesses();
  }, [refreshBusinesses]);
  const handleWorkspaceSignOut = useCallback(async () => {
    setStrategyHandoff(null);
    setSofiaDrafts({});
    return onSignOut();
  }, [onSignOut]);

  useEffect(() => {
    let active = true;
    void getOnboarding()
      .then((progress) => {
        if (!active) return;
        setTutorialStep(progress.tutorial_step);
        if (progress.completed && !progress.tutorial_completed) {
          setTutorialOpen(true);
        }
        setTutorialLoadError(false);
      })
      .catch(() => {
        if (active) setTutorialLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [selectedBusinessId, tutorialRetry]);

  // These hooks share one collection and lock owner for the authenticated workspace.
  // Keep them above the recovery return so pending work and edits survive recovery.
  const canPublishSelectedBusiness = Boolean(
    account?.businesses.some(
      (business) =>
        business.id === selectedBusinessId &&
        (business.role === "owner" || business.role === "admin") &&
        business.capabilities.includes("publish"),
    ),
  );
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
    canPublishSelectedBusiness,
    activeSection === "Aprobaciones",
  );
  const media = useDraftMedia(selectedBusinessId, collection, operations);
  const heygen = useHeyGenGeneration(
    selectedBusinessId,
    collection,
    operations,
  );
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
    facebookPublisher,
    instagramPublisher,
    publisherStatusLoading,
    publishError,
    handleApprove,
    handlePublishTikTok,
    handlePublishFacebook,
    handlePublishInstagram,
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
    handleUploadImage,
    handleReuseImage,
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
      name: "Sebastián",
      role: t("agent.sofiaRole"),
      state:
        loadingDrafts || loadError
          ? t("agent.unverified")
          : hasAiActivity
            ? t("agent.generated")
            : t("agent.noActivity"),
      activity: loadingDrafts
        ? t("agent.checkingActivity")
        : loadError
          ? t("agent.activityFailed")
          : hasAiActivity
            ? t("agent.strategyUsed")
            : t("agent.noGenerations"),
    },
    {
      name: "Valeria",
      role: t("agent.leoRole"),
      state:
        loadingDrafts || loadError
          ? t("agent.unverified")
          : hasAiActivity
            ? t("agent.generated")
            : t("agent.noActivity"),
      activity: loadingDrafts
        ? t("agent.checkingActivity")
        : loadError
          ? t("agent.activityFailed")
          : hasAiActivity
            ? t("agent.aiDraftSaved")
            : t("agent.noGenerations"),
    },
    {
      name: "Edian",
      role: t("agent.miaRole"),
      state: t("agent.available"),
      activity: t("agent.miaPlanned"),
    },
  ];
  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    setShowBusinessForm(false);
  };
  const handleBusinessCreated = (business: Business) => {
    setStrategyHandoff(null);
    addBusiness(business);
    void refreshAccount();
    setShowBusinessForm(false);
  };
  const handleOnboardingComplete = (business: Business) => {
    setStrategyHandoff(null);
    addBusiness(business);
    void refreshAccount();
    setTutorialStep(0);
    setTutorialOpen(true);
  };
  const resumeTutorial = () => {
    setTutorialLoadError(false);
    setTutorialOpen(true);
  };
  const restartTutorial = async () => {
    try {
      const progress = await updateTutorialCompletion(false, 0);
      setTutorialStep(progress.current_step);
      setTutorialLoadError(false);
      setTutorialOpen(true);
    } catch {
      setTutorialLoadError(true);
    }
  };
  const draftMessages = (
    <>
      {loadingDrafts && (
        <p className="empty-state" role="status">
          {t("drafts.loading")}
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
  if (accountError || accountLoading || businessLoading) {
    const denied =
      accountError instanceof ApiError &&
      [401, 403, 404].includes(accountError.status);
    return (
      <WorkspaceAccessState
        denied={denied}
        loading={accountLoading || businessLoading}
        onRetry={async () => {
          setStrategyHandoff(null);
          await Promise.all([refreshAccount(), refreshBusinesses()]);
        }}
        onSignOut={handleWorkspaceSignOut}
      />
    );
  }
  if (businessError) {
    return (
      <main className="workspace-access-state">
        <section className="panel" role="alert">
          <h1>{t("app.accessUnavailable")}</h1>
          <p>{businessError}</p>
          <div className="workspace-access-state__actions">
            <button
              type="button"
              onClick={() => void refreshBusinessesAndClearHandoff()}
            >
              {t("common.retry")}
            </button>
            <button type="button" onClick={() => void handleWorkspaceSignOut()}>
              {t("shell.signOut")}
            </button>
          </div>
        </section>
      </main>
    );
  }
  if (businesses.length === 0) {
    if (facebookHandoff) {
      return (
        <main className="workspace-access-state">
          <section className="panel" role="alert">
            <h1>{t("app.accessUnavailable")}</h1>
            <p>{t("facebook.handoffBusinessUnavailable")}</p>
            <button type="button" onClick={() => void handleWorkspaceSignOut()}>
              {t("facebook.handoffSignOut")}
            </button>
          </section>
        </main>
      );
    }
    return <OnboardingWizard onCreated={handleOnboardingComplete} />;
  }
  const selectedBusinessAccess = account?.businesses.find(
    (business) => business.id === selectedBusinessId,
  );
  const canPublish = canPublishSelectedBusiness;
  const canManageConnections =
    selectedBusinessAccess?.role === "owner" ||
    selectedBusinessAccess?.role === "admin";
  const selectedBusiness =
    businesses.find((business) => business.id === selectedBusinessId) ?? null;
  return (
    <AppShell
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      pendingCount={pendingCount}
      businesses={businesses}
      selectedBusinessId={selectedBusinessId}
      onBusinessChange={(businessId) => {
        setStrategyHandoff(null);
        setSelectedBusinessId(businessId);
      }}
      onAddBusiness={() => setShowBusinessForm(true)}
      onSignOut={handleWorkspaceSignOut}
      onRefreshAccess={async () => {
        setStrategyHandoff(null);
        await Promise.all([refreshAccount(), refreshBusinesses()]);
      }}
      businessError={businessError}
      onRetryBusinessLoad={refreshBusinessesAndClearHandoff}
      userDisplayName={userDisplayName}
      userEmail={session.user.email ?? ""}
    >
      {tutorialLoadError && (
        <p className="workspace-message--error" role="alert">
          {t("tutorial.loadError")}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setTutorialLoadError(false);
              setTutorialRetry((value) => value + 1);
            }}
          >
            {t("common.retry")}
          </button>
        </p>
      )}
      {facebookHandoff &&
        !businessLoading &&
        businesses.length > 0 &&
        !businesses.some(
          (business) => business.id === facebookHandoff.businessId,
        ) && (
          <div className="workspace-message--error" role="alert">
            <p>{t("facebook.handoffBusinessUnavailable")}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => void handleWorkspaceSignOut()}
            >
              {t("facebook.handoffSignOut")}
            </button>
          </div>
        )}
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
          userDisplayName={userDisplayName}
          draftMessages={draftMessages}
          approvingIds={approvingIds}
          busyDraftIds={busyDraftIds}
          imageBusyIds={imageBusyIds}
          editingId={editingId}
          formatDraftDate={(value) => formatDraftDate(value, locale)}
          canApprove={canPublish}
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
          businessId={selectedBusinessId}
          drafts={historyDrafts}
          loading={loadingDrafts}
          error={loadError}
          onDiscussWithSebastian={(message) => {
            setStrategyHandoff({
              businessId: selectedBusinessId,
              message,
            });
            setActiveSection("Equipo IA");
          }}
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
          facebookPublisher={facebookPublisher}
          instagramPublisher={instagramPublisher}
          publisherStatusLoading={publisherStatusLoading}
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
          formatDraftDate={(value) => formatDraftDate(value, locale)}
          canPublish={canPublish}
          canApprove={canPublish}
          handleApprove={handleApprove}
          handlePublishFacebook={handlePublishFacebook}
          handlePublishInstagram={handlePublishInstagram}
          onVerifyFacebookVideo={handleVerifyFacebookVideo}
          handlePublishTikTok={handlePublishTikTok}
          onVerifyTikTok={handleVerifyTikTok}
          handleReject={handleReject}
          handleSaveEdit={handleSaveEdit}
          handleGenerateImage={handleGenerateImage}
          handleUploadImage={handleUploadImage}
          handleReuseImage={handleReuseImage}
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
              <span className="eyebrow">{t("team.eyebrow")}</span>
              <h2>{t("team.title")}</h2>
              <p>{t("team.description")}</p>
            </div>
          </section>
          <section
            className="ai-team-roles"
            data-guide-target="sofia-overview"
            aria-label={t("team.roles")}
          >
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
              draftMessage={
                Object.prototype.hasOwnProperty.call(
                  sofiaDrafts,
                  selectedBusinessId,
                )
                  ? sofiaDrafts[selectedBusinessId]
                  : undefined
              }
              onDraftChange={updateSofiaDraft}
              initialMessage={
                strategyHandoff?.businessId === selectedBusinessId
                  ? strategyHandoff.message
                  : null
              }
              onInitialMessageConsumed={clearStrategyHandoff}
              onViewPlans={() => setActiveSection("Facturación")}
              onContinueWithValeria={handleGenerateContent}
              generationError={generationError}
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
                <span className="eyebrow">{t("team.automation")}</span>
                <h2>{t("team.activity")}</h2>
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
                        agent.state === t("agent.generated") ? "available" : ""
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
          showIntegrationsOnMount={
            Boolean(facebookHandoff) || Boolean(facebookCallbackResult)
          }
          businessId={selectedBusinessId}
          userDisplayName={userDisplayName}
          userEmail={session.user.email ?? ""}
          onSaveDisplayName={onSaveDisplayName}
          business={selectedBusiness}
          membershipRole={selectedBusinessAccess?.role ?? null}
          canEditBusiness={
            selectedBusinessAccess?.capabilities.includes("edit_business") ??
            false
          }
          onSaveBusiness={async (values: BusinessUpdate) => {
            await updateBusiness(selectedBusinessId, values);
            await refreshBusinessesAndClearHandoff();
          }}
          onResumeTutorial={resumeTutorial}
          onRestartTutorial={() => void restartTutorial()}
          canManageConnections={canManageConnections}
          features={account?.features}
          languagePreferences={
            <div data-guide-target="trial-settings">
              <LanguagePreferences businessId={selectedBusinessId} />
              <TrialStatus businessId={selectedBusinessId} />
              <UsageIndicator businessId={selectedBusinessId} />
            </div>
          }
          facebookConnection={
            <FacebookConnection
              businessId={selectedBusinessId}
              handoff={facebookHandoff}
              callbackResult={facebookCallbackResult}
              canManageConnections={canManageConnections}
              onHandoffResolved={onFacebookReturnResolved}
            />
          }
          instagramConnection={
            <InstagramConnection businessId={selectedBusinessId} />
          }
          tiktokConnection={
            <TikTokConnection
              businessId={selectedBusinessId}
              directPublishingEnabled={
                account?.features.tiktok_direct_publishing ?? false
              }
            />
          }
        />
      ) : activeSection === "Facturación" ? (
        <BillingPage
          key={selectedBusinessId}
          businessId={selectedBusinessId}
          membershipRole={selectedBusinessAccess?.role ?? null}
        />
      ) : (
        <section className="panel placeholder-panel">
          <div className="placeholder-icon">✦</div>
          <h2>{getSectionLabel(activeSection, t)}</h2>
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
      {tutorialOpen && (
        <ProductTutorial
          activeSection={activeSection}
          initialStep={tutorialStep}
          onNavigate={handleSectionChange}
          onStepChange={async (step) => {
            const progress = await updateTutorialCompletion(false, step);
            setTutorialStep(progress.current_step);
          }}
          onPause={async (step) => {
            const progress = await updateTutorialCompletion(false, step);
            setTutorialStep(progress.current_step);
            setTutorialOpen(false);
          }}
          onComplete={async (step) => {
            const progress = await updateTutorialCompletion(true, step);
            setTutorialStep(progress.current_step);
          }}
          onDismiss={() => setTutorialOpen(false)}
        />
      )}
    </AppShell>
  );
}
export default App;
