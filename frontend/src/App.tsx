import type { Session } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import AnalyticsPage from "./components/AnalyticsPage";
import ApprovalPage from "./components/ApprovalPage";
import AuthPage from "./components/AuthPage";
import BusinessForm from "./components/BusinessForm";
import ContentPage from "./components/ContentPage";
import CampaignsPage from "./components/CampaignsPage";
import DashboardOverview from "./components/DashboardOverview";
import FacebookConnection from "./components/FacebookConnection";
import type { Section } from "./components/Sidebar";
import { useDraftImages } from "./hooks/useDraftImages";
import type { Business } from "./services/businessesApi";
import {
  acceptImageRevision,
  approveDraft,
  createImageRevision,
  deleteDraft,
  generateContent,
  generateDraftImage,
  getDraftImage,
  getDrafts,
  getImageRevisions,
  publishDraftToFacebook,
  publishDraftToTikTok,
  verifyFacebookVideo,
  verifyTikTokPublication,
  rejectDraft,
  rejectImageRevision,
  updateDraft,
  updateDraftDestinations,
  type Draft,
  type ImageRevision,
} from "./services/draftsApi";
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
const App: FC = () => {
  const {
    session,
    checkingAuth,
    isRecoveringPassword,
    completeRecovery,
    signOut,
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
    />
  );
};

function AuthenticatedApp({
  session,
  onSignOut,
  isRecoveringPassword,
  onRecoveryComplete,
}: {
  session: Session;
  onSignOut: () => Promise<unknown>;
  isRecoveringPassword: boolean;
  onRecoveryComplete: () => void;
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
      ];
      return validSections.find((section) => section === saved) ?? "Resumen";
    } catch {
      return "Resumen";
    }
  });
  const [approvals, setApprovals] = useState<Draft[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const [draftDestinations, setDraftDestinations] = useState<
    Record<string, { facebook: boolean; tiktok: boolean }>
  >({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [busyDraftIds, setBusyDraftIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCaption, setEditCaption] = useState("");
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
  const userId = session.user.id;
  const [showBusinessForm, setShowBusinessForm] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imageBusyIds, setImageBusyIds] = useState<string[]>([]);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const {
    imageInstructions,
    setImageInstructions,
    showImageEditor,
    setShowImageEditor,
    updateImageInstructions,
    addImageSuggestion,
  } = useDraftImages();
  const [revisions, setRevisions] = useState<
    Record<string, ImageRevision | null>
  >({});
  const [revisionBusyIds, setRevisionBusyIds] = useState<string[]>([]);
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>(
    {},
  );
  const imageLocks = useRef(new Set<string>());
  const selectedBusinessRef = useRef(selectedBusinessId);
  useEffect(() => {
    selectedBusinessRef.current = selectedBusinessId;
  }, [selectedBusinessId]);
  // Compare visits, not just IDs: an old A request is stale after A → B → A.
  const businessScope = useMemo(
    () => ({ businessId: selectedBusinessId }),
    [selectedBusinessId],
  );
  const activeBusinessScope = useRef<typeof businessScope | null>(null);
  useEffect(() => {
    activeBusinessScope.current = businessScope;
    return () => {
      activeBusinessScope.current = null;
    };
  }, [businessScope]);
  const isCurrentBusiness = useCallback(
    () => activeBusinessScope.current === businessScope,
    [businessScope],
  );
  const toggleImageEditor = (draftId: string) => {
    if (!showImageEditor[draftId]) void refreshRevision(draftId);
    setShowImageEditor((current) => ({
      ...current,
      [draftId]: !current[draftId],
    }));
  };
  useEffect(() => {
    let active = true;
    // Reset business-specific state before loading another business.
    /* eslint-disable react-hooks/set-state-in-effect */
    setApprovals([]);
    setImageUrls({});
    setImageErrors({});
    setImageInstructions({});
    setShowImageEditor({});
    setRevisions({});
    setRevisionErrors({});
    setEditingId(null);
    setApprovalError(null);
    setPublishError(null);
    setGenerationError(null);
    setLoadError(null);
    if (!selectedBusinessId || !userId) {
      setLoadingDrafts(false);
      return;
    }
    setLoadingDrafts(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const businessId = selectedBusinessId;
    getDrafts(businessId, true)
      .then((drafts) => {
        if (active) setApprovals(drafts);
      })
      .catch(() => {
        if (active) {
          setLoadError(
            "No se pudieron cargar los borradores. Comprueba la conexión con el servidor.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingDrafts(false);
      });
    return () => {
      active = false;
    };
  }, [selectedBusinessId, userId, setImageInstructions, setShowImageEditor]);
  const historyDrafts = useMemo(
    () =>
      approvals.filter(
        (draft) =>
          draft.business_id === selectedBusinessId &&
          (!draft.deleted_at ||
            draft.facebook_publish_status === "published" ||
            draft.tiktok_publish_status === "published" ||
            draft.published_at !== null),
      ),
    [approvals, selectedBusinessId],
  );
  const visibleDrafts = useMemo(
    () => historyDrafts.filter((draft) => !draft.deleted_at),
    [historyDrafts],
  );
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const deleteLocks = useRef(new Set<string>());
  const pendingCount = useMemo(
    () => visibleDrafts.filter((draft) => draft.status === "pending").length,
    [visibleDrafts],
  );
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
  const updateLocalDraft = (updated: Draft) => {
    setApprovals((current) =>
      current.map((draft) => (draft.id === updated.id ? updated : draft)),
    );
  };
  const handleGenerateContent = async () => {
    if (!selectedBusinessId || generating) return;
    const businessId = selectedBusinessId;
    setGenerating(true);
    setGenerationError(null);
    try {
      const draft = await generateContent(businessId);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setApprovals((current) => [draft, ...current]);
        setActiveSection("Aprobaciones");
      }
    } catch (error) {
      console.error("Content generation failed:", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setGenerationError(
          "No se pudo generar el contenido. Inténtalo de nuevo.",
        );
      }
    } finally {
      setGenerating(false);
    }
  };
  const handleApprove = async (id: string) => {
    if (
      approvingIds.includes(id) ||
      busyDraftIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    const draft = visibleDrafts.find((item) => item.id === id);
    if (!draft || draft.status !== "pending") return;
    setApprovalError(null);
    setApprovingIds((current) => [...current, id]);
    try {
      const selection = draftDestinations[id];

      const savedDestinations = draft.publish_destinations ?? ["facebook"];

      const destinations: ("facebook" | "tiktok")[] = [];

      if (selection?.facebook ?? savedDestinations.includes("facebook")) {
        destinations.push("facebook");
      }

      if (selection?.tiktok ?? savedDestinations.includes("tiktok")) {
        destinations.push("tiktok");
      }

      if (destinations.length === 0) {
        throw new Error("Select at least one publishing platform.");
      }

      await updateDraftDestinations(id, destinations);
      const updated = await approveDraft(id);

      if (!isCurrentBusiness()) return;
      updateLocalDraft(updated);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError("No se pudo aprobar el borrador. Inténtalo de nuevo.");
    } finally {
      setApprovingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handlePublishTikTok = async (
    id: string,
    accountId: string,
    privacyLevel: string,
    interactions: {
      disable_comment: boolean;
      disable_duet: boolean;
      disable_stitch: boolean;
    },
  ) => {
    const draft = visibleDrafts.find((item) => item.id === id);

    if (
      !draft ||
      draft.status !== "approved" ||
      draft.tiktok_publish_status !== "not_published" ||
      publishingIds.includes(id)
    ) {
      return;
    }

    setPublishError(null);
    setPublishingIds((current) => [...current, id]);

    try {
      const result = await publishDraftToTikTok(id, {
        account_id: accountId,
        privacy_level: privacyLevel,
        ...interactions,
      });

      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                tiktok_publish_id: result.tiktok_publish_id,
                tiktok_publish_status: "needs_review",
              }
            : item,
        ),
      );
    } catch (error) {
      console.error("TikTok publishing failed:", error);

      if (!isCurrentBusiness()) return;
      setPublishError(
        "No se pudo confirmar la publicación en TikTok. Verifica el estado antes de intentar nuevamente.",
      );

      // The request may have reached TikTok.
      // Do not automatically retry.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  // Publishing button will use this handler when ApprovalPage is connected.
  const handlePublishFacebook = async (id: string) => {
    const draft = visibleDrafts.find((item) => item.id === id);
    if (
      !draft ||
      draft.status !== "approved" ||
      draft.facebook_publish_status !== "not_published" ||
      publishingIds.includes(id)
    ) {
      return;
    }
    setPublishError(null);
    setPublishingIds((current) => [...current, id]);
    try {
      const result = await publishDraftToFacebook(id);
      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                facebook_post_id: result.facebook_post_id,
                facebook_publish_status:
                  result.status === "published" ? "published" : "needs_review",
                published_at:
                  result.status === "published"
                    ? new Date().toISOString()
                    : null,
              }
            : item,
        ),
      );
    } catch {
      if (!isCurrentBusiness()) return;
      setPublishError(
        "No se pudo confirmar la publicación. Revisa Facebook antes de intentar nuevamente.",
      );
      // The server may have marked the draft as needing review.
      // Reloading drafts later will retrieve the authoritative status.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleVerifyTikTok = async (id: string) => {
    if (publishingIds.includes(id)) return;

    setPublishError(null);
    setPublishingIds((current) => [...current, id]);

    try {
      const result = await verifyTikTokPublication(id);

      if (!isCurrentBusiness()) return;
      setApprovals((current) =>
        current.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                tiktok_publish_status:
                  result.status === "published" ? "published" : "needs_review",
              }
            : draft,
        ),
      );
    } catch (error) {
      console.error("TikTok verification failed:", error);

      if (!isCurrentBusiness()) return;
      setPublishError(
        "No se pudo verificar la publicación en TikTok. Inténtalo nuevamente más tarde.",
      );
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleVerifyFacebookVideo = async (id: string) => {
    setPublishError(null);

    try {
      const result = await verifyFacebookVideo(id);

      if (isCurrentBusiness() && result.status === "published") {
        setApprovals((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  facebook_publish_status: "published",
                  published_at: new Date().toISOString(),
                }
              : item,
          ),
        );
      }
    } catch (error) {
      console.error("Facebook video verification failed:", error);
      if (!isCurrentBusiness()) return;
      setPublishError(
        "No se pudo verificar el video. Inténtalo nuevamente más tarde.",
      );
    }
  };

  useEffect(() => {
    const videosToVerify = visibleDrafts.filter(
      (draft) =>
        draft.status === "approved" &&
        draft.media_type === "video" &&
        draft.facebook_publish_status === "needs_review" &&
        !!draft.facebook_post_id,
    );

    if (videosToVerify.length === 0) return;

    let checking = false;

    const checkVideos = async () => {
      if (checking) return;

      checking = true;

      try {
        for (const draft of videosToVerify) {
          if (!isCurrentBusiness()) return;
          const result = await verifyFacebookVideo(draft.id);

          if (isCurrentBusiness() && result.status === "published") {
            setApprovals((current) =>
              current.map((item) =>
                item.id === draft.id
                  ? {
                      ...item,
                      facebook_publish_status: "published",
                      published_at: new Date().toISOString(),
                    }
                  : item,
              ),
            );
          }
        }
      } catch (error) {
        console.error("Automatic Facebook verification failed:", error);
      } finally {
        checking = false;
      }
    };

    void checkVideos();

    const interval = window.setInterval(() => {
      void checkVideos();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [visibleDrafts, isCurrentBusiness]);

  const startEditing = (draft: Draft) => {
    setApprovalError(null);
    setEditingId(draft.id);
    setEditTitle(draft.title);
    setEditCaption(draft.caption);
    setActiveSection("Aprobaciones");
  };
  const handleSaveEdit = async (id: string) => {
    if (!editTitle.trim() || !editCaption.trim()) {
      setApprovalError("El título y el texto no pueden estar vacíos.");
      return;
    }
    if (busyDraftIds.includes(id) || approvingIds.includes(id)) return;
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const updated = await updateDraft(id, {
        title: editTitle.trim(),
        caption: editCaption.trim(),
      });
      if (!isCurrentBusiness()) return;
      updateLocalDraft(updated);
      setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError("No se pudo guardar el borrador. Inténtalo de nuevo.");
    } finally {
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };
  const handleDelete = async (id: string) => {
    if (
      deleteLocks.current.has(id) ||
      busyDraftIds.includes(id) ||
      approvingIds.includes(id) ||
      publishingIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    if (
      !window.confirm(
        "¿Eliminar este elemento de Aprobaciones? Las publicaciones ya realizadas en redes sociales no se eliminarán.",
      )
    )
      return;
    deleteLocks.current.add(id);
    setDeletingIds((current) => [...current, id]);
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const deleted = await deleteDraft(id);
      if (!isCurrentBusiness()) return;
      updateLocalDraft(deleted);
      if (editingId === id) setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError(
        "No se pudo eliminar el elemento. Si hay una operación en curso, espera a que termine e inténtalo de nuevo.",
      );
    } finally {
      deleteLocks.current.delete(id);
      setDeletingIds((current) => current.filter((value) => value !== id));
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };
  const handleReject = async (id: string) => {
    if (
      busyDraftIds.includes(id) ||
      approvingIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    if (
      !window.confirm(
        "¿Rechazar esta publicación? Se conservará en el historial.",
      )
    )
      return;
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const rejected = await rejectDraft(id);
      if (!isCurrentBusiness()) return;
      updateLocalDraft(rejected);
      if (editingId === id) setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError("No se pudo rechazar el borrador. Inténtalo de nuevo.");
    } finally {
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };
  const handleGenerateImage = async (draft: Draft) => {
    if (
      imageLocks.current.has(draft.id) ||
      draft.status !== "pending" ||
      !draft.image_prompt ||
      draft.image_url ||
      !["not_started", "failed"].includes(draft.image_status)
    )
      return;
    if (
      !window.confirm(
        "¿Generar una imagen con IA? Esta operación puede generar un cargo en la API de OpenAI.",
      )
    )
      return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setImageBusyIds((current) => [...current, draft.id]);
    setImageErrors((current) => {
      const next = { ...current };
      delete next[draft.id];
      return next;
    });
    setApprovals((current) =>
      current.map((item) =>
        item.id === draft.id ? { ...item, image_status: "generating" } : item,
      ),
    );
    try {
      const result = await generateDraftImage(draft.id);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
        // Reload the authoritative image status and storage path.
        const refreshedDrafts = await getDrafts(businessId, true);
        if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
          setApprovals(refreshedDrafts);
        }
      }
    } catch (error) {
      console.error("Image generation failed:", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        try {
          const refreshedDrafts = await getDrafts(businessId, true);
          if (
            isCurrentBusiness() &&
            selectedBusinessRef.current === businessId
          ) {
            setApprovals(refreshedDrafts);
          }
        } catch {
          // The request may have completed despite a network error.
        }
        if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
          setImageErrors((current) => ({
            ...current,
            [draft.id]:
              "No se pudo confirmar la generación. Actualiza la página antes de intentar nuevamente.",
          }));
        }
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setImageBusyIds((current) =>
        current.filter((value) => value !== draft.id),
      );
    }
  };
  const handlePreviewImage = async (draft: Draft) => {
    if (imageLocks.current.has(draft.id)) return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setImageBusyIds((current) => [...current, draft.id]);
    setImageErrors((current) => {
      const next = { ...current };
      delete next[draft.id];
      return next;
    });
    try {
      const result = await getDraftImage(draft.id);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
      }
    } catch (error) {
      console.error("Image preview failed:", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageErrors((current) => ({
          ...current,
          [draft.id]: "No se pudo cargar la imagen. Inténtalo nuevamente.",
        }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setImageBusyIds((current) =>
        current.filter((value) => value !== draft.id),
      );
    }
  };
  const refreshRevision = async (draftId: string) => {
    const businessId = selectedBusinessRef.current;
    try {
      const history = await getImageRevisions(draftId);
      if (!isCurrentBusiness() || selectedBusinessRef.current !== businessId)
        return;
      setRevisions((current) => ({
        ...current,
        [draftId]:
          history.find(
            (r) => r.status === "ready" || r.status === "generating",
          ) ?? null,
      }));
      setRevisionErrors((current) => ({ ...current, [draftId]: "" }));
    } catch (error) {
      console.error("Could not load revisions", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setRevisionErrors((current) => ({
          ...current,
          [draftId]: "No se pudo consultar el estado de la edición.",
        }));
      }
    }
  };
  const handleCreateRevision = async (draft: Draft) => {
    const instructions = imageInstructions[draft.id]?.trim() ?? "";
    if (
      !instructions ||
      instructions.length > 1000 ||
      imageLocks.current.has(draft.id)
    )
      return;
    if (
      revisions[draft.id]?.status === "ready" ||
      revisions[draft.id]?.status === "generating"
    )
      return;
    if (
      !window.confirm(
        "¿Crear una nueva imagen con IA? Esta solicitud puede generar un cargo adicional en OpenAI. La original se conservará.",
      )
    )
      return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setRevisionBusyIds((ids) => [...ids, draft.id]);
    setRevisionErrors((current) => ({ ...current, [draft.id]: "" }));
    try {
      const result = await createImageRevision(draft.id, instructions);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: result }));
      }
    } catch (error) {
      console.error("Revision request failed", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        await refreshRevision(draft.id);
        if (!isCurrentBusiness()) return;
        setRevisionErrors((current) => ({
          ...current,
          [draft.id]:
            "No se pudo confirmar la generación. Consulta el estado antes de volver a intentarlo para evitar cargos duplicados.",
        }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setRevisionBusyIds((ids) => ids.filter((id) => id !== draft.id));
    }
  };
  const handleDecideRevision = async (
    draft: Draft,
    decision: "accept" | "reject",
  ) => {
    const revision = revisions[draft.id];
    if (
      !revision ||
      revision.status !== "ready" ||
      imageLocks.current.has(draft.id)
    )
      return;
    if (
      decision === "accept" &&
      !window.confirm("¿Usar la nueva versión para esta publicación?")
    )
      return;
    const businessId = draft.business_id;
    imageLocks.current.add(draft.id);
    setRevisionBusyIds((ids) => [...ids, draft.id]);
    setRevisionErrors((current) => ({ ...current, [draft.id]: "" }));
    try {
      if (decision === "accept") {
        await acceptImageRevision(draft.id, revision.id);
        if (businessId) {
          const [freshDrafts, freshImage] = await Promise.all([
            getDrafts(businessId, true),
            getDraftImage(draft.id),
          ]);
          if (
            isCurrentBusiness() &&
            selectedBusinessRef.current === businessId
          ) {
            setApprovals(freshDrafts);
            setImageUrls((current) => ({
              ...current,
              [draft.id]: freshImage.image_url,
            }));
          }
        }
      } else {
        await rejectImageRevision(draft.id, revision.id);
      }
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: null }));
        setImageInstructions((current) => ({ ...current, [draft.id]: "" }));
      }
    } catch (error) {
      console.error("Revision decision failed", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setRevisionErrors((current) => ({
          ...current,
          [draft.id]:
            "No se pudo confirmar el cambio. Actualiza la página y comprueba el resultado.",
        }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setRevisionBusyIds((ids) => ids.filter((id) => id !== draft.id));
    }
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
    >
      <FacebookConnection businessId={selectedBusinessId} />

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
        <div className="ai-team-section">
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
