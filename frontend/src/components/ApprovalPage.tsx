import {
  useEffect,
  useState,
  type FC,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { Draft, ImageRevision } from "../services/draftsApi";
import { VideoUpload } from "./VideoUpload";
import { supabase } from "../services/supabaseClient";

import { getTikTokCreatorInfo, getTikTokAccounts } from "../services/draftsApi";

type ApprovalPageProps = {
  businessId: string;
  draftDestinations: Record<string, { facebook: boolean; tiktok: boolean }>;

  setDraftDestinations: Dispatch<
    SetStateAction<Record<string, { facebook: boolean; tiktok: boolean }>>
  >;
  loadingDrafts: boolean;
  loadError: string | null;
  pendingCount: number;
  draftMessages: ReactNode;
  visibleDrafts: Draft[];
  approvingIds: string[];
  publishingIds: string[];
  busyDraftIds: string[];
  editingId: string | null;
  editTitle: string;
  editCaption: string;
  setEditTitle: Dispatch<SetStateAction<string>>;
  setEditCaption: Dispatch<SetStateAction<string>>;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  imageUrls: Record<string, string>;
  imageBusyIds: string[];
  imageErrors: Record<string, string>;
  imageInstructions: Record<string, string>;
  showImageEditor: Record<string, boolean>;
  revisions: Record<string, ImageRevision | null>;
  revisionBusyIds: string[];
  revisionErrors: Record<string, string>;
  formatDraftDate: (date: string) => string;
  handleApprove: (id: string) => Promise<void>;
  handlePublishFacebook: (id: string) => Promise<void>;
  handlePublishTikTok: (
    id: string,
    accountId: string,
    privacyLevel: string,
    interactions: {
      disable_comment: boolean;
      disable_duet: boolean;
      disable_stitch: boolean;
    },
  ) => Promise<void>;

  onVerifyTikTok: (id: string) => void;
  onVerifyFacebookVideo: (id: string) => void;
  handleReject: (id: string) => Promise<void>;
  handleSaveEdit: (id: string) => Promise<void>;
  handleGenerateImage: (draft: Draft) => Promise<void>;
  handlePreviewImage: (draft: Draft) => Promise<void>;
  handleCreateRevision: (draft: Draft) => Promise<void>;
  handleDecideRevision: (
    draft: Draft,
    decision: "accept" | "reject",
  ) => Promise<void>;
  refreshRevision: (draftId: string) => Promise<void>;
  addImageSuggestion: (draftId: string, suggestion: string) => void;
  updateImageInstructions: (draftId: string, value: string) => void;
  toggleImageEditor: (draftId: string) => void;
  startEditing: (draft: Draft) => void;
};

const ApprovalPage: FC<ApprovalPageProps> = ({
  businessId,
  draftDestinations,
  setDraftDestinations,
  loadingDrafts,
  loadError,
  pendingCount,
  draftMessages,
  visibleDrafts,
  approvingIds,
  publishingIds,
  busyDraftIds,
  editingId,
  editTitle,
  editCaption,
  setEditTitle,
  setEditCaption,
  setEditingId,
  imageUrls,
  imageBusyIds,
  imageErrors,
  imageInstructions,
  showImageEditor,
  revisions,
  revisionBusyIds,
  revisionErrors,
  formatDraftDate,
  handleApprove,
  handlePublishFacebook,
  handlePublishTikTok,
  onVerifyTikTok,
  onVerifyFacebookVideo,
  handleReject,
  handleSaveEdit,
  handleGenerateImage,
  handlePreviewImage,
  handleCreateRevision,
  handleDecideRevision,
  refreshRevision,
  addImageSuggestion,
  updateImageInstructions,
  toggleImageEditor,
  startEditing,
}) => {
  const [openVideoEditorId, setOpenVideoEditorId] = useState<string | null>(
    null,
  );

  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});

  const [videoLoadingId, setVideoLoadingId] = useState<string | null>(null);

  const [videoErrors, setVideoErrors] = useState<Record<string, string>>({});

  const [copiedScriptId, setCopiedScriptId] = useState<string | null>(null);

  const [tiktokPrivacy, setTikTokPrivacy] = useState<Record<string, string>>(
    {},
  );

  const [tiktokPrivacyOptions, setTikTokPrivacyOptions] = useState<
    Record<string, string[]>
  >({});

  const [tiktokInteractions, setTikTokInteractions] = useState<
    Record<
      string,
      {
        disable_comment: boolean;
        disable_duet: boolean;
        disable_stitch: boolean;
      }
    >
  >({});

  const [tiktokSettingsLoading, setTikTokSettingsLoading] = useState<string[]>(
    [],
  );

  const [tiktokSettingsErrors, setTikTokSettingsErrors] = useState<
    Record<string, string>
  >({});

  type TikTokAccount = {
    id: string;
    account_name: string;
    connection_status: string;
  };

  const [tiktokAccounts, setTikTokAccounts] = useState<TikTokAccount[]>([]);

  const [selectedTikTokAccounts, setSelectedTikTokAccounts] = useState<
    Record<string, string>
  >({});

  async function handleCopyScript(draft: Draft) {
    if (!draft.video_script) return;

    try {
      await navigator.clipboard.writeText(draft.video_script);
      setCopiedScriptId(draft.id);
    } catch {
      setCopiedScriptId(null);
      window.alert(
        "No se pudo copiar el guion. Selecciona el texto para copiarlo.",
      );
    }
  }

  async function handlePreviewVideo(draft: Draft) {
    if (!draft.video_url || videoLoadingId === draft.id) return;

    setVideoLoadingId(draft.id);
    setVideoErrors((current) => ({
      ...current,
      [draft.id]: "",
    }));

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session?.access_token) {
        throw new Error("Debes iniciar sesión.");
      }

      const apiBaseUrl =
        import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

      const response = await fetch(
        `${apiBaseUrl}/drafts/${encodeURIComponent(draft.id)}/video-preview`,
        {
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`No se pudo cargar el video (${response.status}).`);
      }

      const result: { video_url: string } = await response.json();

      if (!result.video_url) {
        throw new Error("No se recibió la URL del video.");
      }

      setVideoUrls((current) => ({
        ...current,
        [draft.id]: result.video_url,
      }));
    } catch (err) {
      setVideoErrors((current) => ({
        ...current,
        [draft.id]:
          err instanceof Error ? err.message : "Error al cargar el video.",
      }));
    } finally {
      setVideoLoadingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    setTikTokAccounts([]);
    setSelectedTikTokAccounts({});

    if (!businessId) return;

    async function loadAccounts() {
      try {
        const response = await getTikTokAccounts(businessId);

        if (!cancelled) {
          setTikTokAccounts(
            response.accounts.filter(
              (account) => account.connection_status === "connected",
            ),
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Error loading TikTok accounts:", error);
        }
      }
    }

    void loadAccounts();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function handleLoadTikTokSettings(draftId: string) {
    if (tiktokSettingsLoading.includes(draftId)) return;

    setTikTokSettingsLoading((current) => [...current, draftId]);
    setTikTokSettingsErrors((current) => ({
      ...current,
      [draftId]: "",
    }));

    try {
      const accountId = selectedTikTokAccounts[draftId];

      if (!accountId) {
        throw new Error("Selecciona una cuenta de TikTok primero.");
      }

      const info = await getTikTokCreatorInfo(draftId, accountId);
      const options = info.privacy_level_options ?? [];

      if (options.length === 0) {
        throw new Error("TikTok no devolvió opciones de privacidad.");
      }

      setTikTokPrivacyOptions((current) => ({
        ...current,
        [draftId]: options,
      }));

      setTikTokPrivacy((current) => ({
        ...current,
        [draftId]: options.includes(current[draftId]) ? current[draftId] : "",
      }));
    } catch (error) {
      setTikTokSettingsErrors((current) => ({
        ...current,
        [draftId]:
          error instanceof Error
            ? error.message
            : "No se pudo cargar la configuración de TikTok.",
      }));
    } finally {
      setTikTokSettingsLoading((current) =>
        current.filter((id) => id !== draftId),
      );
    }
  }

  return (
    <section className="panel approval-page">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Revisión de contenido</span>
          <h2>Cola de aprobaciones</h2>
        </div>

        <span className="approval-counter">
          {loadingDrafts || loadError ? "—" : pendingCount} pendientes
        </span>
      </div>

      <div className="approval-page-list">
        {draftMessages}

        {!loadingDrafts &&
          !loadError &&
          visibleDrafts.map((draft) => (
            <div className="approval-card" key={draft.id}>
              <div className="approval-card-top">
                <span className="channel-tag">{draft.platform}</span>
                <time>{formatDraftDate(draft.created_at)}</time>
              </div>

              {editingId === draft.id ? (
                <div
                  className="draft-edit-form"
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    marginTop: "1rem",
                  }}
                >
                  <label htmlFor={`edit-title-${draft.id}`}>Título</label>

                  <input
                    id={`edit-title-${draft.id}`}
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={200}
                    style={{
                      width: "100%",
                      padding: "0.6rem",
                    }}
                  />

                  <label htmlFor={`edit-caption-${draft.id}`}>
                    Texto de la publicación
                  </label>

                  <textarea
                    id={`edit-caption-${draft.id}`}
                    value={editCaption}
                    onChange={(event) => setEditCaption(event.target.value)}
                    rows={6}
                    style={{
                      width: "100%",
                      padding: "0.6rem",
                    }}
                  />

                  <div className="approval-actions">
                    <button
                      className="approve-button"
                      type="button"
                      disabled={
                        busyDraftIds.includes(draft.id) ||
                        !editTitle.trim() ||
                        !editCaption.trim()
                      }
                      onClick={() => void handleSaveEdit(draft.id)}
                    >
                      {busyDraftIds.includes(draft.id)
                        ? "Guardando..."
                        : "Guardar cambios"}
                    </button>

                    <button
                      className="text-button"
                      type="button"
                      disabled={busyDraftIds.includes(draft.id)}
                      onClick={() => setEditingId(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h3>{draft.title}</h3>
                  <p>{draft.caption}</p>
                </>
              )}

              <div
                className="draft-image-section"
                style={{
                  marginTop: "1.25rem",
                  marginBottom: "1.25rem",
                  display: "grid",
                  gap: "0.75rem",
                }}
              >
                <strong>Imagen de la publicación</strong>

                {imageUrls[draft.id] && (
                  <img
                    src={imageUrls[draft.id]}
                    alt={`Imagen para ${draft.title}`}
                    style={{
                      width: "100%",
                      maxWidth: "420px",
                      borderRadius: "12px",
                      objectFit: "contain",
                    }}
                  />
                )}

                {draft.image_status === "generating" && (
                  <p role="status">
                    La imagen se está generando. Esto puede tardar unos minutos.
                  </p>
                )}

                {draft.image_status === "failed" && (
                  <p role="status">La generación anterior no se completó.</p>
                )}

                {draft.image_status === "completed" && !imageUrls[draft.id] && (
                  <p>La imagen está guardada y lista para visualizar.</p>
                )}

                {imageErrors[draft.id] && (
                  <p role="alert" style={{ color: "#b91c1c" }}>
                    {imageErrors[draft.id]}
                  </p>
                )}

                <div className="approval-actions">
                  {draft.status === "pending" &&
                    !!draft.image_prompt &&
                    !draft.image_url &&
                    ["not_started", "failed"].includes(draft.image_status) && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={
                          imageBusyIds.includes(draft.id) ||
                          busyDraftIds.includes(draft.id) ||
                          approvingIds.includes(draft.id)
                        }
                        onClick={() => void handleGenerateImage(draft)}
                      >
                        {imageBusyIds.includes(draft.id)
                          ? "Generando imagen..."
                          : draft.image_status === "failed"
                            ? "Reintentar imagen"
                            : "✦ Generar imagen"}
                      </button>
                    )}

                  {draft.image_status === "completed" && !!draft.image_url && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={imageBusyIds.includes(draft.id)}
                      onClick={() => void handlePreviewImage(draft)}
                    >
                      {imageBusyIds.includes(draft.id)
                        ? "Cargando imagen..."
                        : imageUrls[draft.id]
                          ? "Actualizar vista previa"
                          : "Ver imagen"}
                    </button>
                  )}
                </div>

                {draft.media_type === "video" &&
                  draft.video_status === "completed" &&
                  !!draft.video_url && (
                    <div
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                      }}
                    >
                      <strong>Video de la publicación</strong>

                      <button
                        type="button"
                        className="text-button"
                        disabled={videoLoadingId === draft.id}
                        onClick={() => {
                          if (videoUrls[draft.id]) {
                            setVideoUrls((current) => {
                              const updated = { ...current };
                              delete updated[draft.id];
                              return updated;
                            });
                          } else {
                            void handlePreviewVideo(draft);
                          }
                        }}
                      >
                        {videoLoadingId === draft.id
                          ? "Cargando video..."
                          : videoUrls[draft.id]
                            ? "Cerrar video"
                            : "🎬 Ver video"}
                      </button>

                      {videoUrls[draft.id] && (
                        <video
                          key={videoUrls[draft.id]}
                          src={videoUrls[draft.id]}
                          controls
                          playsInline
                          preload="metadata"
                          style={{
                            width: "100%",
                            maxWidth: "420px",
                            borderRadius: "12px",
                          }}
                        >
                          Tu navegador no admite la reproducción de video.
                        </video>
                      )}

                      {videoErrors[draft.id] && (
                        <p role="alert">{videoErrors[draft.id]}</p>
                      )}
                    </div>
                  )}

                {draft.video_script && (
                  <div
                    className="heygen-script"
                    style={{
                      padding: "1rem",
                      border: "1px solid #e9ddff",
                      borderRadius: "12px",
                      background: "#faf7ff",
                      display: "grid",
                      gap: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <strong>🎬 Guion para HeyGen</strong>

                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void handleCopyScript(draft)}
                      >
                        {copiedScriptId === draft.id
                          ? "✓ Copiado"
                          : "Copiar guion"}
                      </button>
                    </div>

                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.6,
                        margin: 0,
                      }}
                    >
                      {draft.video_script}
                    </p>
                  </div>
                )}

                {draft.status === "pending" &&
                  draft.video_status !== "completed" && (
                    <div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setOpenVideoEditorId((current) =>
                            current === draft.id ? null : draft.id,
                          )
                        }
                      >
                        {openVideoEditorId === draft.id
                          ? "Cerrar carga de video"
                          : "🎬 Subir video MP4"}
                      </button>

                      {openVideoEditorId === draft.id && (
                        <VideoUpload
                          draftId={draft.id}
                          onUploaded={() => {
                            setOpenVideoEditorId(null);
                            window.location.reload();
                          }}
                        />
                      )}
                    </div>
                  )}

                {!draft.image_prompt && !draft.image_url && (
                  <small>
                    Este borrador no tiene una descripción de imagen generada
                    por IA.
                  </small>
                )}
              </div>

              {draft.status === "pending" && (
                <div style={{ marginBottom: "16px" }}>
                  <strong>Publicar en:</strong>

                  <label style={{ display: "block", marginTop: "8px" }}>
                    <input
                      type="checkbox"
                      checked={
                        draftDestinations[draft.id]?.facebook ??
                        (draft.publish_destinations ?? ["facebook"]).includes(
                          "facebook",
                        )
                      }
                      onChange={(e) =>
                        setDraftDestinations((current) => ({
                          ...current,
                          [draft.id]: {
                            facebook: e.target.checked,
                            tiktok: current[draft.id]?.tiktok ?? false,
                          },
                        }))
                      }
                    />{" "}
                    Facebook
                  </label>

                  {(draft.image_url ||
                    (draft.media_type === "video" && draft.video_url)) && (
                    <label style={{ display: "block", marginTop: "8px" }}>
                      <input
                        type="checkbox"
                        checked={
                          draftDestinations[draft.id]?.tiktok ??
                          (draft.publish_destinations ?? ["facebook"]).includes(
                            "tiktok",
                          )
                        }
                        onChange={(e) =>
                          setDraftDestinations((current) => ({
                            ...current,
                            [draft.id]: {
                              facebook: current[draft.id]?.facebook ?? true,
                              tiktok: e.target.checked,
                            },
                          }))
                        }
                      />{" "}
                      TikTok
                    </label>
                  )}
                </div>
              )}

              {draft.status === "pending" && editingId !== draft.id ? (
                <div className="approval-actions">
                  <button
                    className="approve-button"
                    type="button"
                    disabled={
                      approvingIds.includes(draft.id) ||
                      busyDraftIds.includes(draft.id) ||
                      imageBusyIds.includes(draft.id)
                    }
                    onClick={() => void handleApprove(draft.id)}
                  >
                    {approvingIds.includes(draft.id)
                      ? "Aprobando..."
                      : "✓ Aprobar"}
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
                    {busyDraftIds.includes(draft.id)
                      ? "Procesando..."
                      : "Rechazar"}
                  </button>
                </div>
              ) : draft.status !== "pending" ? (
                <span
                  className={`final-status ${
                    draft.status === "approved" ? "aprobado" : ""
                  }`}
                >
                  {draft.status === "approved"
                    ? "✓ Aprobado"
                    : draft.status === "rejected"
                      ? "✕ Rechazado"
                      : draft.status}
                </span>
              ) : null}

              {draft.status === "approved" && (
                <div className="approval-actions">
                  {(draft.publish_destinations ?? ["facebook"]).includes(
                    "facebook",
                  ) &&
                    draft.facebook_publish_status === "not_published" && (
                      <button
                        className="primary-button facebook-publish-button"
                        type="button"
                        disabled={publishingIds.includes(draft.id)}
                        onClick={() => {
                          if (
                            window.confirm(
                              draft.media_type === "video"
                                ? "¿Enviar este video y su descripción a Facebook? Puede tardar en procesarse."
                                : draft.image_url
                                  ? "¿Publicar esta imagen y su descripción en Facebook?"
                                  : "¿Publicar este texto en Facebook?",
                            )
                          ) {
                            void handlePublishFacebook(draft.id);
                          }
                        }}
                      >
                        {publishingIds.includes(draft.id)
                          ? "Publicando..."
                          : "Publicar en Facebook"}
                      </button>
                    )}

                  {draft.facebook_publish_status === "published" && (
                    <span
                      className="facebook-publish-status is-published"
                      role="status"
                    >
                      ✓ Publicado en Facebook
                    </span>
                  )}

                  {draft.facebook_publish_status === "publishing" && (
                    <span
                      className="facebook-publish-status is-publishing"
                      role="status"
                    >
                      Publicación en proceso. Actualiza para verificar.
                    </span>
                  )}

                  {draft.facebook_publish_status === "needs_review" && (
                    <div
                      style={{
                        display: "grid",
                        gap: "0.5rem",
                      }}
                    >
                      <span
                        className="facebook-publish-status needs-review"
                        role="alert"
                      >
                        Publicación por verificar. Revisa Facebook antes de
                        volver a intentar.
                      </span>

                      {draft.media_type === "video" &&
                        !!draft.facebook_post_id && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => onVerifyFacebookVideo(draft.id)}
                          >
                            Verificar publicación en Facebook
                          </button>
                        )}
                    </div>
                  )}
                </div>
              )}

              {draft.status === "approved" &&
                (draft.publish_destinations ?? []).includes("tiktok") && (
                  <div
                    style={{
                      display: "grid",
                      gap: "0.75rem",
                      marginTop: "1rem",
                    }}
                  >
                    {draft.tiktok_publish_status === "not_published" && (
                      <>
                        <label htmlFor={`tiktok-account-${draft.id}`}>
                          Cuenta de TikTok
                        </label>

                        <select
                          className="tiktok-privacy-select"
                          id={`tiktok-account-${draft.id}`}
                          value={selectedTikTokAccounts[draft.id] ?? ""}
                          onChange={(event) => {
                            setSelectedTikTokAccounts((current) => ({
                              ...current,
                              [draft.id]: event.target.value,
                            }));

                            setTikTokPrivacyOptions((current) => ({
                              ...current,
                              [draft.id]: [],
                            }));

                            setTikTokPrivacy((current) => ({
                              ...current,
                              [draft.id]: "",
                            }));
                          }}
                        >
                          <option value="">Selecciona una cuenta</option>
                          {tiktokAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.account_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="text-button"
                          disabled={tiktokSettingsLoading.includes(draft.id)}
                          onClick={() =>
                            void handleLoadTikTokSettings(draft.id)
                          }
                        >
                          {tiktokSettingsLoading.includes(draft.id)
                            ? "Cargando configuración..."
                            : "Configurar publicación en TikTok"}
                        </button>

                        {tiktokSettingsErrors[draft.id] && (
                          <p role="alert">{tiktokSettingsErrors[draft.id]}</p>
                        )}

                        {!!tiktokPrivacyOptions[draft.id]?.length && (
                          <>
                            <label htmlFor={`tiktok-privacy-${draft.id}`}>
                              Privacidad de TikTok
                            </label>

                            <select
                              className="tiktok-privacy-select"
                              id={`tiktok-privacy-${draft.id}`}
                              value={tiktokPrivacy[draft.id] ?? ""}
                              onChange={(event) =>
                                setTikTokPrivacy((current) => ({
                                  ...current,
                                  [draft.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Selecciona privacidad</option>
                              {tiktokPrivacyOptions[draft.id].map((option) => (
                                <option key={option} value={option}>
                                  {option === "PUBLIC_TO_EVERYONE"
                                    ? "Público — Todos"
                                    : option === "MUTUAL_FOLLOW_FRIENDS"
                                      ? "Amigos"
                                      : option === "SELF_ONLY"
                                        ? "Privado — Solo yo"
                                        : option}
                                </option>
                              ))}
                            </select>

                            <div style={{ display: "grid", gap: "0.75rem" }}>
                              {(
                                [
                                  ["disable_comment", "Permitir comentarios"],
                                  ["disable_duet", "Permitir dúos"],
                                  ["disable_stitch", "Permitir Stitch"],
                                ] as const
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  style={{
                                    display: "flex",
                                    gap: "0.5rem",
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={
                                      !(
                                        tiktokInteractions[draft.id]?.[key] ??
                                        false
                                      )
                                    }
                                    onChange={(event) =>
                                      setTikTokInteractions((current) => ({
                                        ...current,
                                        [draft.id]: {
                                          disable_comment:
                                            current[draft.id]
                                              ?.disable_comment ?? false,
                                          disable_duet:
                                            current[draft.id]?.disable_duet ??
                                            false,
                                          disable_stitch:
                                            current[draft.id]?.disable_stitch ??
                                            false,
                                          [key]: !event.target.checked,
                                        },
                                      }))
                                    }
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>

                            <button
                              type="button"
                              className="primary-button"
                              disabled={
                                !selectedTikTokAccounts[draft.id] ||
                                !tiktokPrivacy[draft.id] ||
                                publishingIds.includes(draft.id)
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "¿Confirmas que revisaste el contenido y deseas publicarlo en TikTok con la privacidad seleccionada?",
                                  )
                                ) {
                                  void handlePublishTikTok(
                                    draft.id,
                                    selectedTikTokAccounts[draft.id],
                                    tiktokPrivacy[draft.id],
                                    tiktokInteractions[draft.id] ?? {
                                      disable_comment: false,
                                      disable_duet: false,
                                      disable_stitch: false,
                                    },
                                  );
                                }
                              }}
                            >
                              {publishingIds.includes(draft.id)
                                ? "Enviando a TikTok..."
                                : "Publicar en TikTok"}
                            </button>
                          </>
                        )}
                      </>
                    )}

                    {draft.tiktok_publish_status === "published" && (
                      <p role="status">✓ Publicado en TikTok</p>
                    )}

                    {draft.tiktok_publish_status === "publishing" && (
                      <p role="status">Enviando publicación a TikTok...</p>
                    )}

                    {draft.tiktok_publish_status === "needs_review" && (
                      <>
                        <p role="status">
                          Publicación pendiente de verificación en TikTok.
                        </p>

                        {!!draft.tiktok_publish_id && (
                          <button
                            type="button"
                            className="text-button"
                            disabled={publishingIds.includes(draft.id)}
                            onClick={() => onVerifyTikTok(draft.id)}
                          >
                            Verificar publicación en TikTok
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

              {/* Spanish AI image editor */}

              {draft.status === "pending" &&
                draft.image_status === "completed" &&
                !!draft.image_url && (
                  <div className="ai-image-editor">
                    <button
                      type="button"
                      className="ai-editor-toggle"
                      onClick={() => toggleImageEditor(draft.id)}
                      aria-expanded={!!showImageEditor[draft.id]}
                      aria-controls={`ai-editor-content-${draft.id}`}
                    >
                      <span>✦ Editar imagen con IA</span>

                      <span aria-hidden="true">
                        {showImageEditor[draft.id] ? "−" : "+"}
                      </span>
                    </button>

                    {showImageEditor[draft.id] && (
                      <div
                        id={`ai-editor-content-${draft.id}`}
                        className="ai-editor-content"
                      >
                        <p>
                          Describe en español los cambios. La imagen original se
                          conservará hasta que aceptes una versión nueva.
                        </p>

                        {revisionErrors[draft.id] && (
                          <p role="alert" style={{ color: "#b91c1c" }}>
                            {revisionErrors[draft.id]}
                          </p>
                        )}

                        {revisions[draft.id]?.status === "ready" ? (
                          <>
                            <p>
                              <strong>Versión nueva lista para revisar</strong>
                            </p>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "repeat(auto-fit, minmax(200px, 1fr))",
                                gap: "1rem",
                              }}
                            >
                              <div>
                                <strong>Original</strong>

                                {imageUrls[draft.id] ? (
                                  <img
                                    src={imageUrls[draft.id]}
                                    alt="Imagen original"
                                    style={{
                                      width: "100%",
                                      borderRadius: 12,
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handlePreviewImage(draft)
                                    }
                                  >
                                    Ver original
                                  </button>
                                )}
                              </div>

                              <div>
                                <strong>Nueva versión</strong>

                                {revisions[draft.id]?.image_url ? (
                                  <img
                                    src={revisions[draft.id]!.image_url!}
                                    alt="Versión editada"
                                    style={{
                                      width: "100%",
                                      borderRadius: 12,
                                    }}
                                  />
                                ) : (
                                  <p>
                                    No se recibió una vista previa. Actualiza el
                                    estado.
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="approval-actions">
                              <button
                                type="button"
                                className="approve-button"
                                disabled={revisionBusyIds.includes(draft.id)}
                                onClick={() =>
                                  void handleDecideRevision(draft, "accept")
                                }
                              >
                                ✓ Aceptar nueva versión
                              </button>

                              <button
                                type="button"
                                className="reject-button"
                                disabled={revisionBusyIds.includes(draft.id)}
                                onClick={() =>
                                  void handleDecideRevision(draft, "reject")
                                }
                              >
                                Conservar original
                              </button>
                            </div>
                          </>
                        ) : revisions[draft.id]?.status === "generating" ? (
                          <p role="status">
                            La nueva imagen se está generando. No solicites otra
                            hasta confirmar el resultado.
                          </p>
                        ) : (
                          <>
                            <label htmlFor={`image-instructions-${draft.id}`}>
                              Instrucciones para la IA
                            </label>

                            <textarea
                              id={`image-instructions-${draft.id}`}
                              value={imageInstructions[draft.id] || ""}
                              onChange={(event) =>
                                updateImageInstructions(
                                  draft.id,
                                  event.target.value,
                                )
                              }
                              placeholder="Ejemplo: Mejora la iluminación y cambia el fondo por una mesa elegante."
                              rows={4}
                              maxLength={1000}
                              disabled={revisionBusyIds.includes(draft.id)}
                            />

                            <div className="ai-editor-suggestions">
                              {[
                                "Mejorar iluminación",
                                "Cambiar el fondo",
                                "Estilo más profesional",
                              ].map((suggestion) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  disabled={revisionBusyIds.includes(draft.id)}
                                  onClick={() =>
                                    addImageSuggestion(draft.id, suggestion)
                                  }
                                >
                                  + {suggestion}
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              className="primary-button ai-regenerate-button"
                              disabled={
                                revisionBusyIds.includes(draft.id) ||
                                !imageInstructions[draft.id]?.trim()
                              }
                              onClick={() => void handleCreateRevision(draft)}
                            >
                              {revisionBusyIds.includes(draft.id)
                                ? "Generando nueva versión..."
                                : "✦ Generar nueva versión"}
                            </button>

                            <small>
                              La generación con IA puede tener un costo
                              adicional. Se solicitará confirmación antes de
                              continuar.
                            </small>
                          </>
                        )}

                        <button
                          type="button"
                          className="text-button"
                          disabled={revisionBusyIds.includes(draft.id)}
                          onClick={() => void refreshRevision(draft.id)}
                        >
                          Actualizar estado
                        </button>
                      </div>
                    )}
                  </div>
                )}
            </div>
          ))}

        {!loadingDrafts && !loadError && visibleDrafts.length === 0 && (
          <p className="empty-state">Todavía no hay borradores para revisar.</p>
        )}
      </div>
    </section>
  );
};

export default ApprovalPage;
