import { useState, useRef, useEffect } from "react";

export function useDraftOperations(selectedBusinessId: string) {
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const [busyDraftIds, setBusyDraftIds] = useState<string[]>([]);
  const imageLocks = useRef(new Set<string>());
  useEffect(() => {
    // Clear the displayed error, but retain pending locks across business visits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApprovalError(null);
  }, [selectedBusinessId]);

  return {
    approvalError,
    setApprovalError,
    approvingIds,
    setApprovingIds,
    publishingIds,
    setPublishingIds,
    busyDraftIds,
    setBusyDraftIds,
    imageLocks,
  };
}

export type DraftOperations = ReturnType<typeof useDraftOperations>;
