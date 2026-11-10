import { DraftEditForm } from "../../drafts/components/DraftEditForm";
import { ImageRevisionEditor } from "../../media/components/ImageRevisionEditor";
import type { FC } from "react";
import { Trash2 } from "lucide-react";
import { DraftMediaPanel } from "../../media/components/DraftMediaPanel";
import { useApprovalMedia } from "../../media/hooks/useApprovalMedia";
import type { ApprovalPageProps } from "../types/ApprovalPageProps";

const ApprovalPage: FC<ApprovalPageProps> = ({
  handleDelete,
  deletingIds,
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
  const browserMedia = useApprovalMedia();
  const {
    downloadBusyId,
    copiedCaptionId,
    handleCopyCaption,
    handleDownloadVideo,
  } = browserMedia;

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
                <DraftEditForm
                  draft={draft}
                  editTitle={editTitle}
                  editCaption={editCaption}
                  setEditTitle={setEditTitle}
                  setEditCaption={setEditCaption}
                  busyDraftIds={busyDraftIds}
                  handleSaveEdit={handleSaveEdit}
                  setEditingId={setEditingId}
                />
              ) : (
                <>
                  <h3>{draft.title}</h3>
                  <p>{draft.caption}</p>
                </>
              )}

              <DraftMediaPanel
                draft={draft}
                imageUrls={imageUrls}
                imageErrors={imageErrors}
                imageBusyIds={imageBusyIds}
                busyDraftIds={busyDraftIds}
                approvingIds={approvingIds}
                handleGenerateImage={handleGenerateImage}
                handlePreviewImage={handlePreviewImage}
                browserMedia={browserMedia}
              />

              <div className="approval-card-controls">
                {draft.status === "pending" && (
                  <div>
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
                              tiktok: false,
                            },
                          }))
                        }
                      />{" "}
                      Facebook
                    </label>
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
                  draft.media_type === "video" &&
                  draft.video_status === "completed" &&
                  !!draft.video_url && (
                    <div className="tiktok-manual-actions">
                      <button
                        type="button"
                        className="tiktok-download-button"
                        disabled={downloadBusyId === draft.id}
                        onClick={() => void handleDownloadVideo(draft)}
                      >
                        {downloadBusyId === draft.id
                          ? "Descargando video..."
                          : "⬇ Descargar video para TikTok"}
                      </button>
                      <button
                        type="button"
                        className="tiktok-copy-button"
                        onClick={() => void handleCopyCaption(draft)}
                      >
                        {copiedCaptionId === draft.id
                          ? "✓ Descripción copiada"
                          : "Copiar descripción y hashtags"}
                      </button>
                    </div>
                  )}

                {/* Spanish AI image editor */}

                {draft.status === "pending" &&
                  draft.image_status === "completed" &&
                  !!draft.image_url && (
                    <ImageRevisionEditor
                      draft={draft}
                      toggleImageEditor={toggleImageEditor}
                      showImageEditor={showImageEditor}
                      revisionErrors={revisionErrors}
                      revisions={revisions}
                      imageUrls={imageUrls}
                      handlePreviewImage={handlePreviewImage}
                      revisionBusyIds={revisionBusyIds}
                      handleDecideRevision={handleDecideRevision}
                      imageInstructions={imageInstructions}
                      updateImageInstructions={updateImageInstructions}
                      addImageSuggestion={addImageSuggestion}
                      handleCreateRevision={handleCreateRevision}
                      refreshRevision={refreshRevision}
                    />
                  )}

                <div className="approval-actions approval-delete-actions">
                  <button
                    className="reject-button"
                    type="button"
                    disabled={
                      busyDraftIds.includes(draft.id) ||
                      approvingIds.includes(draft.id) ||
                      publishingIds.includes(draft.id) ||
                      imageBusyIds.includes(draft.id) ||
                      revisionBusyIds.includes(draft.id) ||
                      draft.image_status === "generating" ||
                      draft.video_status === "generating" ||
                      draft.video_status === "uploading" ||
                      draft.facebook_publish_status === "publishing" ||
                      draft.tiktok_publish_status === "publishing" ||
                      revisions[draft.id]?.status === "generating"
                    }
                    onClick={() => void handleDelete(draft.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />{" "}
                    {deletingIds.includes(draft.id)
                      ? "Eliminando..."
                      : "Eliminar"}
                  </button>
                </div>
              </div>
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
