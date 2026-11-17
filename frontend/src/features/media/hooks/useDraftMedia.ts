import { useState, useEffect } from "react";
import {
  acceptImageRevision,
  createImageRevision,
  generateDraftImage,
  getDraftImage,
  getDrafts,
  getImageRevisions,
  rejectImageRevision,
  reuseDraftImage,
  uploadDraftImage,
  type Draft,
  type ImageRevision,
} from "../../../services/draftsApi";
import { useDraftImages } from "../../../hooks/useDraftImages";
import type { DraftCollection } from "../../drafts/hooks/useDraftCollection";
import type { DraftOperations } from "../../drafts/hooks/useDraftOperations";
import { useLocalization } from "../../../app/useLocalization";
import { useRef } from "react";

function apiErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const separator = error.message.indexOf(": ");
  if (separator < 0) return undefined;
  try {
    const payload = JSON.parse(error.message.slice(separator + 2));
    return typeof payload.detail === "string" ? payload.detail : undefined;
  } catch {
    return undefined;
  }
}

export function useDraftMedia(
  selectedBusinessId: string,
  collection: DraftCollection,
  operations: Pick<DraftOperations, "imageLocks" | "busyDraftIds">,
) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
  const { setApprovals, selectedBusinessRef, isCurrentBusiness } = collection;
  const { imageLocks } = operations;
  useEffect(() => {
    setImageUrls({});
    setImageErrors({});
    setImageInstructions({});
    setShowImageEditor({});
    setRevisions({});
    setRevisionErrors({});
  }, [selectedBusinessId, setImageInstructions, setShowImageEditor]);
  const toggleImageEditor = (draftId: string) => {
    if (!showImageEditor[draftId]) void refreshRevision(draftId);
    setShowImageEditor((current) => ({
      ...current,
      [draftId]: !current[draftId],
    }));
  };
  const handleGenerateImage = async (draft: Draft) => {
    if (
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id) ||
      draft.status !== "pending" ||
      !draft.image_prompt ||
      draft.image_url ||
      !["not_started", "failed"].includes(draft.image_status)
    )
      return;
    if (!window.confirm(tRef.current("media.confirmGenerate"))) return;
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
            [draft.id]: tRef.current("media.generationUncertain"),
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
          [draft.id]: tRef.current("media.imageLoadError"),
        }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setImageBusyIds((current) =>
        current.filter((value) => value !== draft.id),
      );
    }
  };
  const handleUploadImage = async (
    draft: Draft,
    file: File,
  ): Promise<boolean> => {
    if (
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id) ||
      draft.status !== "pending" ||
      draft.image_url ||
      draft.media_type === "video" ||
      draft.video_url ||
      !["not_started", "failed"].includes(draft.video_status) ||
      !["not_started", "failed"].includes(draft.image_status)
    )
      return false;
    const businessId = draft.business_id;
    if (!businessId) return false;
    imageLocks.current.add(draft.id);
    setImageBusyIds((current) => [...current, draft.id]);
    setImageErrors((current) => {
      const next = { ...current };
      delete next[draft.id];
      return next;
    });
    try {
      const result = await uploadDraftImage(draft.id, file);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
        setApprovals((current) =>
          current.map((item) =>
            item.id === draft.id
              ? {
                  ...item,
                  media_type: "image",
                  image_status: "completed",
                  image_url: result.image_url,
                }
              : item,
          ),
        );
        try {
          const refreshedDrafts = await getDrafts(businessId, true);
          if (
            isCurrentBusiness() &&
            selectedBusinessRef.current === businessId
          ) {
            setApprovals(refreshedDrafts);
          }
        } catch (refreshError) {
          console.error(
            "Drafts could not be refreshed after image upload:",
            refreshError,
          );
        }
      }
      return true;
    } catch (error) {
      console.error("Image upload failed:", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageErrors((current) => ({
          ...current,
          [draft.id]:
            apiErrorDetail(error) ?? tRef.current("media.imageUploadError"),
        }));
      }
      return false;
    } finally {
      imageLocks.current.delete(draft.id);
      setImageBusyIds((current) =>
        current.filter((value) => value !== draft.id),
      );
    }
  };
  const handleReuseImage = async (
    draft: Draft,
    sourceDraftId: string,
  ): Promise<boolean> => {
    const businessId = draft.business_id;
    if (
      !businessId ||
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id) ||
      draft.status !== "pending" ||
      draft.image_url ||
      draft.media_type === "video" ||
      draft.video_url ||
      !["not_started", "failed"].includes(draft.video_status) ||
      !["not_started", "failed"].includes(draft.image_status)
    )
      return false;
    imageLocks.current.add(draft.id);
    setImageBusyIds((current) => [...current, draft.id]);
    setImageErrors((current) => {
      const next = { ...current };
      delete next[draft.id];
      return next;
    });
    try {
      const result = await reuseDraftImage(draft.id, sourceDraftId);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageUrls((current) => ({
          ...current,
          [draft.id]: result.image_url,
        }));
        setApprovals((current) =>
          current.map((item) =>
            item.id === draft.id
              ? {
                  ...item,
                  media_type: "image",
                  image_status: "completed",
                  image_url: result.image_url,
                }
              : item,
          ),
        );
        try {
          const refreshedDrafts = await getDrafts(businessId, true);
          if (
            isCurrentBusiness() &&
            selectedBusinessRef.current === businessId
          ) {
            setApprovals(refreshedDrafts);
          }
        } catch (refreshError) {
          console.error(
            "Drafts could not be refreshed after image reuse:",
            refreshError,
          );
        }
      }
      return true;
    } catch (error) {
      console.error("Image reuse failed:", error);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setImageErrors((current) => ({
          ...current,
          [draft.id]:
            apiErrorDetail(error) ?? tRef.current("media.imageReuseError"),
        }));
      }
      return false;
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
          [draftId]: tRef.current("media.revisionStatusError"),
        }));
      }
    }
  };
  const handleCreateRevision = async (draft: Draft) => {
    const instructions = imageInstructions[draft.id]?.trim() ?? "";
    if (
      !instructions ||
      instructions.length > 1000 ||
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id)
    )
      return;
    if (
      revisions[draft.id]?.status === "ready" ||
      revisions[draft.id]?.status === "generating"
    )
      return;
    if (!window.confirm(tRef.current("media.confirmRevision"))) return;
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
          [draft.id]: tRef.current("media.revisionUncertain"),
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
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id)
    )
      return;
    if (
      decision === "accept" &&
      !window.confirm(tRef.current("media.confirmAccept"))
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
          [draft.id]: tRef.current("media.revisionDecisionError"),
        }));
      }
    } finally {
      imageLocks.current.delete(draft.id);
      setRevisionBusyIds((ids) => ids.filter((id) => id !== draft.id));
    }
  };

  return {
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
  };
}
