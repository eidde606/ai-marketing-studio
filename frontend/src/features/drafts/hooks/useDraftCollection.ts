import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getDrafts, type Draft } from "../../../services/draftsApi";

export function useDraftCollection(selectedBusinessId: string, userId: string) {
  const [approvals, setApprovals] = useState<Draft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  useEffect(() => {
    let active = true;
    // Reset business-specific state before loading another business.
    /* eslint-disable react-hooks/set-state-in-effect */
    setApprovals([]);
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
  }, [selectedBusinessId, userId]);
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
  const pendingCount = useMemo(
    () => visibleDrafts.filter((draft) => draft.status === "pending").length,
    [visibleDrafts],
  );
  const updateLocalDraft = (updated: Draft) => {
    setApprovals((current) =>
      current.map((draft) => (draft.id === updated.id ? updated : draft)),
    );
  };

  return {
    approvals,
    setApprovals,
    loadingDrafts,
    loadError,
    historyDrafts,
    visibleDrafts,
    pendingCount,
    selectedBusinessRef,
    isCurrentBusiness,
    updateLocalDraft,
  };
}

export type DraftCollection = ReturnType<typeof useDraftCollection>;
