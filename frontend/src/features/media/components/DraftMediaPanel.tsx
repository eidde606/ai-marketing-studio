import { useState } from "react";
import { HeyGenGenerationPanel } from "./HeyGenGenerationPanel";
import type { HeyGenController } from "../hooks/useHeyGenGeneration";
import type { Draft } from "../../../services/draftsApi";
import type { useDraftMedia } from "../hooks/useDraftMedia";
import type { useApprovalMedia } from "../hooks/useApprovalMedia";
import { VideoUpload } from "./VideoUpload";
import { useLocalization } from "../../../app/localization";
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
  const { t } = useLocalization();
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
      aria-label={t("media.ariaLabel")}
    >
      <strong>
        {draft.media_type === "video"
          ? t("media.videoAssets")
          : t("media.postImage")}
      </strong>

      {imageUrls[draft.id] && (
        <img
          className="approval-media-image"
          src={imageUrls[draft.id]}
          alt={t("media.imageFor", { title: draft.title })}
        />
      )}

      {draft.image_status === "generating" && (
        <p role="status">
          {t("media.imageGenerating")}
        </p>
      )}

      {draft.image_status === "failed" && (
        <p role="status">{t("media.imageFailed")}</p>
      )}

      {draft.image_status === "completed" && !imageUrls[draft.id] && (
        <p>{t("media.imageReady")}</p>
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
                ? t("media.generatingImage")
                : draft.image_status === "failed"
                  ? t("media.retryImage")
                  : t("media.createImage")}
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
              ? t("media.loadingImage")
              : imageUrls[draft.id]
                ? t("media.refreshPreview")
                : t("media.viewImage")}
          </button>
        )}
      </div>

      {draft.media_type === "video" &&
        draft.video_status === "completed" &&
        !!draft.video_url && (
          <div className="approval-video-preview">
            <strong>{t("media.videoPost")}</strong>

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
                ? t("media.loadingVideo")
                : videoUrls[draft.id]
                  ? t("media.closeVideo")
                  : t("media.viewVideo")}
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
                {t("media.videoUnsupported")}
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
            <strong>{t("media.heygenScript")}</strong>

            <button
              type="button"
              className="text-button"
              onClick={() => void handleCopyScript(draft)}
            >
              {copiedScriptId === draft.id
                ? t("media.copied")
                : t("media.copyScript")}
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
                ? t("media.closeHeygen")
                : t("media.createHeygen")}
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
                ? t("media.closeUpload")
                : t("media.uploadVideo")}
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
          {t("media.noImagePrompt")}
        </small>
      )}
    </section>
  );
}
