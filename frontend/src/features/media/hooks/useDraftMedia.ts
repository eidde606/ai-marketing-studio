import { useState, useEffect } from "react";
import {
  acceptImageRevision,
  createImageRevision,
  generateDraftImage,
  getDraftImage,
  getDrafts,
  getImageRevisions,
  rejectImageRevision,
  type Draft,
  type ImageRevision,
} from "../../../services/draftsApi";
import { useDraftImages } from "../../../hooks/useDraftImages";
import type { DraftCollection } from "../../drafts/hooks/useDraftCollection";
import type { DraftOperations } from "../../drafts/hooks/useDraftOperations";

export function useDraftMedia(
  selectedBusinessId: string,
  collection: DraftCollection,
  operations: Pick<DraftOperations, "imageLocks" | "busyDraftIds">,
) {
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
    /* eslint-disable react-hooks/set-state-in-effect */
    setImageUrls({});
    setImageErrors({});
    setImageInstructions({});
    setShowImageEditor({});
    setRevisions({});
    setRevisionErrors({});
    /* eslint-enable react-hooks/set-state-in-effect */
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
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id)
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
      imageLocks.current.has(draft.id) ||
      operations.busyDraftIds.includes(draft.id)
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
    handlePreviewImage,
    refreshRevision,
    handleCreateRevision,
    handleDecideRevision,
  };
}
