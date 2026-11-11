import { useState } from "react";
import { HeyGenGenerationPanel } from "./HeyGenGenerationPanel";
import type { HeyGenController } from "../hooks/useHeyGenGeneration";
import type { Draft } from "../../../services/draftsApi";
import type { useDraftMedia } from "../hooks/useDraftMedia";
import type { useApprovalMedia } from "../hooks/useApprovalMedia";
import { VideoUpload } from "./VideoUpload";
type Props = {
  heygen?: HeyGenController;
  draft: Draft;
  busyDraftIds: string[];
  approvingIds: string[];
  browserMedia: ReturnType<typeof useApprovalMedia>;
} & Pick<
  ReturnType<typeof useDraftMedia>,
  | "imageUrls"
  | "imageErrors"
  | "imageBusyIds"
  | "handleGenerateImage"
  | "handlePreviewImage"
>;
export function DraftMediaPanel({
  heygen,
  draft,
  imageUrls,
  imageErrors,
  imageBusyIds,
  busyDraftIds,
  approvingIds,
  handleGenerateImage,
  handlePreviewImage,
  browserMedia,
}: Props) {
  const [heygenOpen, setHeygenOpen] = useState(false);
  const {
    openVideoEditorId,
    setOpenVideoEditorId,
    videoUrls,
    setVideoUrls,
    videoLoadingId,
    videoErrors,
    copiedScriptId,
    handleCopyScript,
    handlePreviewVideo,
  } = browserMedia;
  return (
    <section
      className="draft-image-section"
      aria-label="Multimedia y herramientas para el borrador"
    >
      <strong>
        {draft.media_type === "video"
          ? "Multimedia del video"
          : "Imagen de la publicación"}
      </strong>

      {imageUrls[draft.id] && (
        <img
          className="approval-media-image"
          src={imageUrls[draft.id]}
          alt={`Imagen para ${draft.title}`}
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
          <div className="approval-video-preview">
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
                className="approval-video-player"
                key={videoUrls[draft.id]}
                src={videoUrls[draft.id]}
                controls
                playsInline
                preload="metadata"
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
        <section className="heygen-script">
          <div
            className="heygen-script-header"
          >
            <strong>🎬 Guion para HeyGen</strong>

            <button
              type="button"
              className="text-button"
              onClick={() => void handleCopyScript(draft)}
            >
              {copiedScriptId === draft.id ? "✓ Copiado" : "Copiar guion"}
            </button>
          </div>

          <p
            className="heygen-script-text"
          >
            {draft.video_script}
          </p>
        </section>
      )}

      {heygen &&
        (draft.status === "pending" || draft.media_type === "video") && (
          <div className="heygen-generation-section">
            <button
              type="button"
              className="text-button"
              disabled={openVideoEditorId === draft.id}
              onClick={() => setHeygenOpen((value) => !value)}
            >
              {heygenOpen
                ? "Cerrar generación de video"
                : "Crear o recuperar video con HeyGen"}
            </button>
            {heygenOpen && (
              <HeyGenGenerationPanel draft={draft} controller={heygen} />
            )}
          </div>
        )}

      {draft.status === "pending" &&
        !heygenOpen &&
        !busyDraftIds.includes(draft.id) &&
        ["not_started", "failed"].includes(draft.video_status) && (
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
          Este borrador no tiene una descripción de imagen generada por IA.
        </small>
      )}
    </section>
  );
}
