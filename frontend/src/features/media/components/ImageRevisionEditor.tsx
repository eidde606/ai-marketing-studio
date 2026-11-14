import type { Draft } from "../../../services/draftsApi";
import type { useDraftMedia } from "../hooks/useDraftMedia";
import { useLocalization } from "../../../app/localization";
type Props = { draft: Draft } & Pick<
  ReturnType<typeof useDraftMedia>,
  | "toggleImageEditor"
  | "showImageEditor"
  | "revisionErrors"
  | "revisions"
  | "imageUrls"
  | "handlePreviewImage"
  | "revisionBusyIds"
  | "handleDecideRevision"
  | "imageInstructions"
  | "updateImageInstructions"
  | "addImageSuggestion"
  | "handleCreateRevision"
  | "refreshRevision"
>;
export function ImageRevisionEditor({
  draft,
  toggleImageEditor,
  showImageEditor,
  revisionErrors,
  revisions,
  imageUrls,
  handlePreviewImage,
  revisionBusyIds,
  handleDecideRevision,
  imageInstructions,
  updateImageInstructions,
  addImageSuggestion,
  handleCreateRevision,
  refreshRevision,
}: Props) {
  const { t } = useLocalization();
  return (
    <div className="ai-image-editor">
      <button
        type="button"
        className="ai-editor-toggle"
        onClick={() => toggleImageEditor(draft.id)}
        aria-expanded={!!showImageEditor[draft.id]}
        aria-controls={`ai-editor-content-${draft.id}`}
      >
        <span>{t("media.imageEditor")}</span>

        <span aria-hidden="true">{showImageEditor[draft.id] ? "−" : "+"}</span>
      </button>

      {showImageEditor[draft.id] && (
        <div id={`ai-editor-content-${draft.id}`} className="ai-editor-content">
          <p>
            {t("media.imageInstructions")}
          </p>

          {revisionErrors[draft.id] && (
            <p role="alert" style={{ color: "#b91c1c" }}>
              {revisionErrors[draft.id]}
            </p>
          )}

          {revisions[draft.id]?.status === "ready" ? (
            <>
              <p>
                <strong>{t("media.revisionReady")}</strong>
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "1rem",
                }}
              >
                <div>
                  <strong>{t("media.original")}</strong>

                  {imageUrls[draft.id] ? (
                    <img
                      src={imageUrls[draft.id]}
                      alt={t("media.original")}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handlePreviewImage(draft)}
                    >
                      {t("media.viewOriginal")}
                    </button>
                  )}
                </div>

                <div>
                  <strong>{t("media.newVersion")}</strong>

                  {revisions[draft.id]?.image_url ? (
                    <img
                      src={revisions[draft.id]!.image_url!}
                      alt={t("media.newVersion")}
                      style={{
                        width: "100%",
                        borderRadius: 12,
                      }}
                    />
                  ) : (
                    <p>{t("media.noPreview")}</p>
                  )}
                </div>
              </div>

              <div className="approval-actions">
                <button
                  type="button"
                  className="approve-button"
                  disabled={revisionBusyIds.includes(draft.id)}
                  onClick={() => void handleDecideRevision(draft, "accept")}
                >
                  {t("media.acceptRevision")}
                </button>

                <button
                  type="button"
                  className="reject-button"
                  disabled={revisionBusyIds.includes(draft.id)}
                  onClick={() => void handleDecideRevision(draft, "reject")}
                >
                  {t("media.keepOriginal")}
                </button>
              </div>
            </>
          ) : revisions[draft.id]?.status === "generating" ? (
            <p role="status">
              {t("media.revisionGenerating")}
            </p>
          ) : (
            <>
              <label htmlFor={`image-instructions-${draft.id}`}>
                {t("media.instructionsLabel")}
              </label>

              <textarea
                id={`image-instructions-${draft.id}`}
                value={imageInstructions[draft.id] || ""}
                onChange={(event) =>
                  updateImageInstructions(draft.id, event.target.value)
                }
                placeholder={t("media.instructionsPlaceholder")}
                rows={4}
                maxLength={1000}
                disabled={revisionBusyIds.includes(draft.id)}
              />

              <div className="ai-editor-suggestions">
                {[
                  ["media.suggestion.lighting", t("media.suggestion.lighting")],
                  [
                    "media.suggestion.background",
                    t("media.suggestion.background"),
                  ],
                  [
                    "media.suggestion.professional",
                    t("media.suggestion.professional"),
                  ],
                ].map((suggestion) => (
                  <button
                    key={suggestion[0]}
                    type="button"
                    disabled={revisionBusyIds.includes(draft.id)}
                    onClick={() => addImageSuggestion(draft.id, suggestion[1])}
                  >
                    + {suggestion[1]}
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
                  ? t("media.generatingRevision")
                  : t("media.generateRevision")}
              </button>

              <small>
                {t("media.costNotice")}
              </small>
            </>
          )}

          <button
            type="button"
            className="text-button"
            disabled={revisionBusyIds.includes(draft.id)}
            onClick={() => void refreshRevision(draft.id)}
          >
            {t("media.refreshStatus")}
          </button>
        </div>
      )}
    </div>
  );
}
