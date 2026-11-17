import { DraftEditForm } from "../../drafts/components/DraftEditForm";
import { ImageRevisionEditor } from "../../media/components/ImageRevisionEditor";
import type { FC } from "react";
import { Trash2 } from "lucide-react";
import { DraftMediaPanel } from "../../media/components/DraftMediaPanel";
import { useApprovalMedia } from "../../media/hooks/useApprovalMedia";
import type { ApprovalPageProps } from "../types/ApprovalPageProps";
import { useLocalization } from "../../../app/useLocalization";
import type { Draft } from "../../../services/draftsApi";

const ApprovalPage: FC<ApprovalPageProps> = ({
  heygen,
  businessId,
  handleDelete,
  deletingIds,
  draftDestinations,
  setDraftDestinations,
  facebookPublisher,
  instagramPublisher,
  publisherStatusLoading,
  loadingDrafts,
  loadError,
  pendingCount,
  canApprove,
  canPublish,
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
  handlePublishInstagram,
  onVerifyFacebookVideo,
  handleReject,
  handleSaveEdit,
  handleGenerateImage,
  handleUploadImage,
  handleReuseImage,
  handlePreviewImage,
  handleCreateRevision,
  handleDecideRevision,
  refreshRevision,
  addImageSuggestion,
  updateImageInstructions,
  toggleImageEditor,
  startEditing,
}) => {
  const { t } = useLocalization();
  const browserMedia = useApprovalMedia();
  const {
    downloadBusyId,
    copiedCaptionId,
    handleCopyCaption,
    handleDownloadVideo,
  } = browserMedia;
  const statusLabel = (status: string) =>
    status === "pending"
      ? t("approval.status.pending")
      : status === "approved"
        ? t("approval.status.approved")
        : status === "rejected"
          ? t("approval.status.rejected")
          : status;
  const instagramIneligibilityReason = (draft: Draft) => {
    if (draft.media_type !== "image") {
      return t(
        draft.media_type === "text"
          ? "approval.instagramReason.textDraft"
          : "approval.instagramReason.videoDraft",
      );
    }
    if (draft.image_status === "not_started") {
      return t("approval.instagramReason.imageNotStarted");
    }
    if (draft.image_status === "generating") {
      return t("approval.instagramReason.imageGenerating");
    }
    if (draft.image_status === "failed") {
      return t("approval.instagramReason.imageFailed");
    }
    if (!draft.image_url) {
      return t("approval.instagramReason.imageMissing");
    }
    const imagePath = draft.image_url.split(/[?#]/, 1)[0];
    if (!/\.(jpe?g)$/i.test(imagePath)) {
      const format =
        imagePath.match(/\.[^.\\/]+$/)?.[0] ??
        t("approval.instagramReason.unknownFormat");
      return t("approval.instagramReason.jpegOnly", { format });
    }
    if (draft.caption.length > 2200) {
      return t("approval.instagramReason.captionTooLong");
    }
    return null;
  };

  return (
    <section className="approval-page" data-guide-target="approval-queue">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t("approval.eyebrow")}</span>
          <h2>{t("approval.title")}</h2>
          <p>{t("approval.description")}</p>
        </div>

        <span className="approval-counter">
          {loadingDrafts || loadError
            ? "—"
            : t("approval.pendingCount", { count: pendingCount })}
        </span>
      </div>

      <div className="approval-page-list" data-guide-target="publish-options">
        {draftMessages}

        {!loadingDrafts &&
          !loadError &&
          visibleDrafts.map((draft) => {
            const instagramReason = instagramIneligibilityReason(draft);
            const instagramEligible = instagramReason === null;
            return (
              <div className="approval-card" key={`${businessId}:${draft.id}`}>
                <div className="approval-card-top">
                  <span className="channel-tag">{draft.platform}</span>
                  <span
                    className={`approval-state approval-state--${draft.status}`}
                  >
                    {statusLabel(draft.status)}
                  </span>
                  <time>{formatDraftDate(draft.created_at)}</time>
                </div>

                <section className="approval-card-information">
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
                    <h3>{draft.title}</h3>
                  )}
                </section>

                <DraftMediaPanel
                  heygen={heygen}
                  draft={draft}
                  imageUrls={imageUrls}
                  imageErrors={imageErrors}
                  imageBusyIds={imageBusyIds}
                  busyDraftIds={busyDraftIds}
                  approvingIds={approvingIds}
                  handleGenerateImage={handleGenerateImage}
                  handleUploadImage={handleUploadImage}
                  handleReuseImage={handleReuseImage}
                  handlePreviewImage={handlePreviewImage}
                  browserMedia={browserMedia}
                />

                {editingId !== draft.id && (
                  <section className="approval-card-caption">
                    <h4>{t("approval.caption")}</h4>
                    <p>{draft.caption}</p>
                  </section>
                )}

                <section
                  className="approval-card-controls"
                  aria-label={t("approval.actions", { title: draft.title })}
                >
                  {canPublish && draft.status === "pending" && (
                    <div className="approval-platform-selection">
                      <strong>{t("approval.destinationOptional")}</strong>
                      {publisherStatusLoading && (
                        <small role="status">
                          {t("approval.loadingConnections")}
                        </small>
                      )}
                      {facebookPublisher && (
                        <label className="approval-platform-option">
                          <input
                            type="checkbox"
                            checked={
                              !!facebookPublisher &&
                              (draftDestinations[draft.id]?.facebook ??
                                (
                                  draft.publish_destinations ?? ["facebook"]
                                ).includes("facebook"))
                            }
                            onChange={(event) =>
                              setDraftDestinations((current) => ({
                                ...current,
                                [draft.id]: {
                                  facebook: event.target.checked,
                                  instagram:
                                    current[draft.id]?.instagram ??
                                    (draft.publish_destinations ?? []).includes(
                                      "instagram",
                                    ),
                                },
                              }))
                            }
                          />
                          <span>
                            <strong>Facebook</strong>
                            <small>
                              {t("approval.connectedFacebook", {
                                name: facebookPublisher,
                              })}
                            </small>
                          </span>
                        </label>
                      )}
                      {instagramPublisher && (
                        <label className="approval-platform-option">
                          <input
                            type="checkbox"
                            disabled={!instagramEligible}
                            checked={
                              !!instagramPublisher &&
                              instagramEligible &&
                              (draftDestinations[draft.id]?.instagram ??
                                (draft.publish_destinations ?? []).includes(
                                  "instagram",
                                ))
                            }
                            onChange={(event) =>
                              setDraftDestinations((current) => ({
                                ...current,
                                [draft.id]: {
                                  facebook:
                                    current[draft.id]?.facebook ??
                                    (draft.publish_destinations ?? []).includes(
                                      "facebook",
                                    ),
                                  instagram: event.target.checked,
                                },
                              }))
                            }
                          />
                          <span>
                            <strong>Instagram</strong>
                            <small>
                              {t("approval.connectedInstagram", {
                                username: instagramPublisher
                                  ? `@${instagramPublisher}`
                                  : "",
                              })}
                            </small>
                          </span>
                        </label>
                      )}
                      {instagramPublisher && instagramEligible && (
                        <small>
                          {t("approval.instagramMediaRequirements")}
                        </small>
                      )}
                      {instagramPublisher && !instagramEligible && (
                        <small role="status">{instagramReason}</small>
                      )}
                      {!facebookPublisher && !instagramPublisher && (
                        <small>{t("approval.noPublishingAccounts")}</small>
                      )}
                      {facebookPublisher && (
                        <small>{t("approval.manualDestination")}</small>
                      )}
                    </div>
                  )}

                  <div className="approval-card-decisions">
                    {draft.status === "pending" && editingId !== draft.id ? (
                      <div className="approval-actions">
                        {canApprove && (
                          <button
                            className="approve-button"
                            type="button"
                            disabled={
                              approvingIds.includes(draft.id) ||
                              publisherStatusLoading ||
                              busyDraftIds.includes(draft.id) ||
                              imageBusyIds.includes(draft.id)
                            }
                            onClick={() => void handleApprove(draft.id)}
                          >
                            {approvingIds.includes(draft.id)
                              ? t("approval.approving")
                              : t("approval.approve")}
                          </button>
                        )}

                        <button
                          className="text-button"
                          type="button"
                          disabled={
                            busyDraftIds.includes(draft.id) ||
                            approvingIds.includes(draft.id)
                          }
                          onClick={() => startEditing(draft)}
                        >
                          {t("approval.edit")}
                        </button>

                        {canApprove && (
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
                              ? t("approval.processing")
                              : t("approval.reject")}
                          </button>
                        )}
                      </div>
                    ) : draft.status !== "pending" ? (
                      <span
                        className={`final-status ${
                          draft.status === "approved" ? "aprobado" : ""
                        }`}
                      >
                        {draft.status === "approved"
                          ? t("approval.finalApproved")
                          : draft.status === "rejected"
                            ? t("approval.finalRejected")
                            : draft.status}
                      </span>
                    ) : null}
                  </div>

                  {draft.status === "approved" && (
                    <div className="approval-card-publishing">
                      {canPublish &&
                        (draft.publish_destinations ?? ["facebook"]).includes(
                          "facebook",
                        ) && (
                          <span className="facebook-publisher-name">
                            {facebookPublisher
                              ? t("approval.connectedFacebook", {
                                  name: facebookPublisher,
                                })
                              : t("approval.publishingAccountUnavailable")}
                          </span>
                        )}
                      {canPublish &&
                        (draft.publish_destinations ?? ["facebook"]).includes(
                          "facebook",
                        ) &&
                        draft.facebook_publish_status === "not_published" && (
                          <button
                            className="primary-button facebook-publish-button"
                            type="button"
                            disabled={
                              !facebookPublisher ||
                              publisherStatusLoading ||
                              publishingIds.includes(draft.id)
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  draft.media_type === "video"
                                    ? t("approval.confirmVideo")
                                    : draft.image_url
                                      ? t("approval.confirmImage")
                                      : t("approval.confirmText"),
                                )
                              ) {
                                void handlePublishFacebook(draft.id);
                              }
                            }}
                          >
                            {publishingIds.includes(draft.id)
                              ? t("approval.publishing")
                              : t("approval.publishFacebook")}
                          </button>
                        )}

                      {(draft.publish_destinations ?? []).includes(
                        "instagram",
                      ) && (
                        <div className="instagram-publishing-controls">
                          <span className="instagram-publisher-name">
                            {instagramPublisher
                              ? t("approval.connectedInstagram", {
                                  username: `@${instagramPublisher}`,
                                })
                              : t("approval.publishingAccountUnavailable")}
                          </span>
                          {instagramEligible &&
                          ((draft.instagram_publish_status ??
                            "not_published") === "not_published" ||
                            draft.instagram_publish_status === "failed") ? (
                            <button
                              className="primary-button instagram-publish-button"
                              type="button"
                              disabled={
                                !instagramPublisher ||
                                publisherStatusLoading ||
                                publishingIds.includes(draft.id)
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    t("approval.confirmInstagramImage"),
                                  )
                                ) {
                                  void handlePublishInstagram(draft.id);
                                }
                              }}
                            >
                              {publishingIds.includes(draft.id)
                                ? t("approval.publishing")
                                : draft.instagram_publish_status === "failed"
                                  ? t("approval.retryInstagram")
                                  : t("approval.publishInstagram")}
                            </button>
                          ) : null}
                          {draft.instagram_publish_status === "published" && (
                            <span
                              className="facebook-publish-status is-published"
                              role="status"
                            >
                              {t("approval.publishedInstagram")}
                              {draft.instagram_permalink && (
                                <a
                                  className="instagram-published-link"
                                  href={draft.instagram_permalink}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t("approval.viewInstagramPost")}
                                </a>
                              )}
                            </span>
                          )}
                          {draft.instagram_publish_status === "publishing" && (
                            <span
                              className="facebook-publish-status is-publishing"
                              role="status"
                            >
                              {t("approval.publishingStatus")}
                            </span>
                          )}
                          {draft.instagram_publish_status === "failed" && (
                            <span
                              className="facebook-publish-status instagram-failed"
                              role="status"
                            >
                              {t("approval.instagramRetrySafe")}
                            </span>
                          )}
                          {draft.instagram_publish_status ===
                            "needs_review" && (
                            <span
                              className="facebook-publish-status needs-review"
                              role="alert"
                            >
                              {t("approval.instagramNeedsReview")}
                            </span>
                          )}
                        </div>
                      )}

                      {draft.facebook_publish_status === "published" && (
                        <span
                          className="facebook-publish-status is-published"
                          role="status"
                        >
                          {t("approval.publishedFacebook")}
                        </span>
                      )}

                      {draft.facebook_publish_status === "publishing" && (
                        <span
                          className="facebook-publish-status is-publishing"
                          role="status"
                        >
                          {t("approval.publishingStatus")}
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
                            {t("approval.needsReview")}
                          </span>

                          {draft.media_type === "video" &&
                            !!draft.facebook_post_id && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => onVerifyFacebookVideo(draft.id)}
                              >
                                {t("approval.verifyFacebook")}
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
                      <div className="approval-card-secondary tiktok-manual-actions">
                        <button
                          type="button"
                          className="tiktok-download-button"
                          disabled={downloadBusyId === draft.id}
                          onClick={() => void handleDownloadVideo(draft)}
                        >
                          {downloadBusyId === draft.id
                            ? t("approval.downloading")
                            : t("approval.downloadTikTok")}
                        </button>
                        <button
                          type="button"
                          className="tiktok-copy-button"
                          onClick={() => void handleCopyCaption(draft)}
                        >
                          {copiedCaptionId === draft.id
                            ? t("approval.captionCopied")
                            : t("approval.copyCaption")}
                        </button>
                      </div>
                    )}

                  {draft.status === "pending" &&
                    draft.image_status === "completed" &&
                    !!draft.image_url && (
                      <div className="approval-card-revision">
                        <ImageRevisionEditor
                          draft={draft}
                          toggleImageEditor={toggleImageEditor}
                          showImageEditor={showImageEditor}
                          revisionErrors={revisionErrors}
                          revisions={revisions}
                          imageUrls={imageUrls}
                          handlePreviewImage={handlePreviewImage}
                          revisionBusyIds={[
                            ...revisionBusyIds,
                            ...busyDraftIds,
                          ]}
                          handleDecideRevision={handleDecideRevision}
                          imageInstructions={imageInstructions}
                          updateImageInstructions={updateImageInstructions}
                          addImageSuggestion={addImageSuggestion}
                          handleCreateRevision={handleCreateRevision}
                          refreshRevision={refreshRevision}
                        />
                      </div>
                    )}

                  <div className="approval-card-secondary approval-actions approval-delete-actions">
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
                        draft.instagram_publish_status === "publishing" ||
                        draft.tiktok_publish_status === "publishing" ||
                        revisions[draft.id]?.status === "generating"
                      }
                      onClick={() => void handleDelete(draft.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />{" "}
                      {deletingIds.includes(draft.id)
                        ? t("approval.deleting")
                        : t("approval.delete")}
                    </button>
                  </div>
                </section>
              </div>
            );
          })}

        {!loadingDrafts && !loadError && visibleDrafts.length === 0 && (
          <p className="empty-state">{t("approval.empty")}</p>
        )}
      </div>
    </section>
  );
};

export default ApprovalPage;
