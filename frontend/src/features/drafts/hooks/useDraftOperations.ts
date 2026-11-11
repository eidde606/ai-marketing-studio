import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type SetStateAction,
} from "react";

export function useDraftOperations(selectedBusinessId: string) {
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const [publishingIds, setPublishingIds] = useState<string[]>([]);
  const [actionBusyIds, setActionBusyIds] = useState<string[]>([]);
  const actionBusyRef = useRef<string[]>([]);
  const [heygenBusyIds, setHeygenBusyIds] = useState<string[]>([]);
  const heygenOwners = useRef(new Map<string, symbol>());
  const imageLocks = useRef(new Set<string>());

  // Existing edit/reject/delete callers own this list. Keep its ref current
  // synchronously so recovery cannot slip in before React's next render.
  const setBusyDraftIds = useCallback((update: SetStateAction<string[]>) => {
    const next =
      typeof update === "function" ? update(actionBusyRef.current) : update;
    actionBusyRef.current = next;
    setActionBusyIds(next);
  }, []);
  const acquireHeyGenLock = useCallback((id: string, owner: symbol) => {
    if (actionBusyRef.current.includes(id) || imageLocks.current.has(id))
      return false;
    const existing = heygenOwners.current.get(id);
    if (existing) return existing === owner;
    heygenOwners.current.set(id, owner);
    setHeygenBusyIds([...heygenOwners.current.keys()]);
    return true;
  }, []);
  const releaseHeyGenLock = useCallback((id: string, owner: symbol) => {
    if (heygenOwners.current.get(id) !== owner) return;
    heygenOwners.current.delete(id);
    setHeygenBusyIds([...heygenOwners.current.keys()]);
  }, []);

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
    busyDraftIds: [...new Set([...actionBusyIds, ...heygenBusyIds])],
    setBusyDraftIds,
    acquireHeyGenLock,
    releaseHeyGenLock,
    imageLocks,
  };
}

export type DraftOperations = ReturnType<typeof useDraftOperations>;
