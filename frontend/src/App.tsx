import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session } from "@supabase/supabase-js";
import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FC } from "react";
import AnalyticsPage from "./components/AnalyticsPage";
import ApprovalPage from "./components/ApprovalPage";
import AuthPage from "./components/AuthPage";
import BusinessForm from "./components/BusinessForm";
import ContentPage from "./components/ContentPage";
import DashboardOverview from "./components/DashboardOverview";
import FacebookConnection from "./components/FacebookConnection";
import Sidebar, { type Section } from "./components/Sidebar";
import { useDraftImages } from "./hooks/useDraftImages";
import { getBusinesses, type Business } from "./services/businessesApi";
import {
  acceptImageRevision,
  approveDraft,
  createImageRevision,
  generateContent,
  generateDraftImage,
  getDraftImage,
  getDrafts,
  getImageRevisions,
  publishDraftToFacebook,
  rejectDraft,
  rejectImageRevision,
  updateDraft,
  type Draft,
  type ImageRevision,
} from "./services/draftsApi";
import { getConnectedFacebookAccounts } from "./services/facebookApi";
import { supabase } from "./services/supabaseClient";

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
  const [session, setSession] = useState<Session | null>(null);
  const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);

  const [checkingAuth, setCheckingAuth] = useState(true);
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
  const [publishError, setPublishError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [busyDraftIds, setBusyDraftIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");

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
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || !selectedBusinessId) return;
    try {
      window.localStorage.setItem(
        `ai-marketing-studio:business:${userId}`,
        selectedBusinessId,
      );
    } catch {
      // Ignore unavailable browser storage.
    }
  }, [userId, selectedBusinessId]);
  const [businessError, setBusinessError] = useState<string | null>(null);
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
  const toggleImageEditor = (draftId: string) => {
    if (!showImageEditor[draftId]) void refreshRevision(draftId);
    setShowImageEditor((current) => ({
      ...current,
      [draftId]: !current[draftId],
    }));
  };
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active) {
          setSession(session);
          setCheckingAuth(false);
        }
      })
      .catch(() => {
        if (active) setCheckingAuth(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (active) {
        if (event === "PASSWORD_RECOVERY") {
          setIsRecoveringPassword(true);
        }

        setSession(nextSession);
        setCheckingAuth(false);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    getBusinesses()
      .then((data) => {
        if (!active) return;
        setBusinesses(data);
        setSelectedBusinessId((current) => {
          let saved = "";
          try {
            saved =
              window.localStorage.getItem(
                `ai-marketing-studio:business:${userId}`,
              ) ?? "";
          } catch {
            // Continue with a default if storage is unavailable.
          }
          const valid = (id: string) =>
            data.some((business) => business.id === id);
          return valid(current)
            ? current
            : valid(saved)
              ? saved
              : (data[0]?.id ?? "");
        });
        setBusinessError(null);
      })
      .catch((error) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : String(error);

          setBusinessError(`No se pudieron cargar los negocios: ${message}`);
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);
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
    setLoadError(null);
    if (!selectedBusinessId || !userId) {
      setLoadingDrafts(false);
      return;
    }
    setLoadingDrafts(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const businessId = selectedBusinessId;
    getDrafts(businessId)
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
  const visibleDrafts = useMemo(
    () => approvals.filter((draft) => draft.business_id === selectedBusinessId),
    [approvals, selectedBusinessId],
  );
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
    setBusinesses((current) => [...current, business]);
    setSelectedBusinessId(business.id);
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
      if (selectedBusinessRef.current === businessId) {
        setApprovals((current) => [draft, ...current]);
        setActiveSection("Aprobaciones");
      }
    } catch (error) {
      console.error("Content generation failed:", error);
      if (selectedBusinessRef.current === businessId) {
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
      const updated = await approveDraft(id);
      updateLocalDraft(updated);
    } catch {
      setApprovalError("No se pudo aprobar el borrador. Inténtalo de nuevo.");
    } finally {
      setApprovingIds((current) => current.filter((value) => value !== id));
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
      setApprovals((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                facebook_post_id: result.facebook_post_id,
                facebook_publish_status: "published",
                published_at: new Date().toISOString(),
              }
            : item,
        ),
      );
    } catch {
      setPublishError(
        "No se pudo confirmar la publicación. Revisa Facebook antes de intentar nuevamente.",
      );
      // The server may have marked the draft as needing review.
      // Reloading drafts later will retrieve the authoritative status.
    } finally {
      setPublishingIds((current) => current.filter((value) => value !== id));
    }
  };
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
      updateLocalDraft(updated);
      setEditingId(null);
    } catch {
      setApprovalError("No se pudo guardar el borrador. Inténtalo de nuevo.");
    } finally {
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
      updateLocalDraft(rejected);
      if (editingId === id) setEditingId(null);
    } catch {
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
      if (selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
        // Reload the authoritative image status and storage path.
        const refreshedDrafts = await getDrafts(businessId);
        if (selectedBusinessRef.current === businessId) {
          setApprovals(refreshedDrafts);
        }
      }
    } catch (error) {
      console.error("Image generation failed:", error);
      if (selectedBusinessRef.current === businessId) {
        try {
          const refreshedDrafts = await getDrafts(businessId);
          if (selectedBusinessRef.current === businessId) {
            setApprovals(refreshedDrafts);
          }
        } catch {
          // The request may have completed despite a network error.
        }
        if (selectedBusinessRef.current === businessId) {
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
      if (selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
      }
    } catch (error) {
      console.error("Image preview failed:", error);
      if (selectedBusinessRef.current === businessId) {
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
      if (selectedBusinessRef.current !== businessId) return;
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
      if (selectedBusinessRef.current === businessId) {
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
      if (selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: result }));
      }
    } catch (error) {
      console.error("Revision request failed", error);
      if (selectedBusinessRef.current === businessId) {
        await refreshRevision(draft.id);
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
            getDrafts(businessId),
            getDraftImage(draft.id),
          ]);
          if (selectedBusinessRef.current === businessId) {
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
      if (selectedBusinessRef.current === businessId) {
        setRevisions((current) => ({ ...current, [draft.id]: null }));
        setImageInstructions((current) => ({ ...current, [draft.id]: "" }));
      }
    } catch (error) {
      console.error("Revision decision failed", error);
      if (selectedBusinessRef.current === businessId) {
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
  if (checkingAuth) {
    return <div className="auth-loading">Cargando...</div>;
  }

  if (isRecoveringPassword) {
    return (
      <AuthPage
        recoveryMode
        onRecoveryComplete={() => setIsRecoveringPassword(false)}
      />
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        pendingCount={pendingCount}
      />
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading">
            <span className="eyebrow">Estudio de marketing</span>
            <h1>{activeSection}</h1>
          </div>
          <div className="topbar-actions">
            <select
              aria-label="Seleccionar negocio"
              value={selectedBusinessId}
              onChange={(event) => setSelectedBusinessId(event.target.value)}
              disabled={businesses.length === 0}
            >
              {businesses.length === 0 && (
                <option value="">Sin negocios</option>
              )}
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary-button add-business-button"
              onClick={() => setShowBusinessForm(true)}
            >
              + Agregar negocio
            </button>
            <div className="topbar-account">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="account-trigger"
                    aria-label="Abrir menú de Ángela"
                  >
                    <span className="avatar small">Á</span>
                    <span className="account-name">Ángela</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-1">
                      <span>Ángela</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Administradora
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void supabase.auth.signOut()}
                    className="cursor-pointer"
                  >
                    <LogOut className="mr-2 size-4" />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {businessError && (
              <span className="topbar-error" role="alert">
                {businessError}
              </span>
            )}
          </div>
        </header>

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
            visibleDrafts={visibleDrafts}
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
        ) : activeSection === "Contenido" ? (
          <ContentPage
            key={selectedBusinessId}
            drafts={visibleDrafts}
            loading={loadingDrafts}
            error={loadError}
          />
        ) : activeSection === "Analíticas" ? (
          <AnalyticsPage
            key={selectedBusinessId}
            drafts={visibleDrafts}
            loading={loadingDrafts}
            error={loadError}
          />
        ) : activeSection === "Aprobaciones" ? (
          <ApprovalPage
            loadingDrafts={loadingDrafts}
            loadError={loadError}
            pendingCount={pendingCount}
            draftMessages={draftMessages}
            visibleDrafts={visibleDrafts}
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
      </main>
    </div>
  );
};
export default App;
