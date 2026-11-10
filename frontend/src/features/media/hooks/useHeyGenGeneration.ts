import { useRef, useState } from "react";
import { getDrafts, type Draft } from "../../../services/draftsApi";
import type { DraftCollection } from "../../drafts/hooks/useDraftCollection";
import type { DraftOperations } from "../../drafts/hooks/useDraftOperations";
import {
  getGeneration,
  reconcileGeneration,
  submitGeneration,
  type Generation,
  type GenerationRequest,
} from "../services/heygenGenerationApi";

type State = {
  checked: boolean;
  busy: boolean;
  uncertain: boolean;
  job: Generation | null;
  error: string | null;
};
const empty: State = {
  checked: false,
  busy: false,
  uncertain: false,
  job: null,
  error: null,
};
export function useHeyGenGeneration(
  businessId: string,
  collection: DraftCollection,
  operations: DraftOperations,
) {
  const [states, setStates] = useState<Record<string, State>>({});
  // Workspace lifetime: navigation/recovery must not release an in-flight lock.
  const locks = useRef(new Set<string>());
  const owner = useRef(Symbol("heygen"));
  const retained = useRef(new Set<string>());
  const submitted = useRef(new Set<string>());
  const key = (id: string) => `${businessId}:${id}`;
  const state = (id: string) => states[key(id)] ?? empty;
  const eligible = (draft: Draft) =>
    draft.business_id === businessId &&
    draft.status === "pending" &&
    !draft.deleted_at &&
    !draft.published_at &&
    !draft.video_url &&
    draft.image_status !== "generating" &&
    ["not_started", "failed"].includes(draft.video_status) &&
    draft.facebook_publish_status === "not_published" &&
    draft.tiktok_publish_status === "not_published";
  const canGenerate = (draft: Draft) => {
    const current = state(draft.id);
    return (
      eligible(draft) &&
      current.checked &&
      !current.busy &&
      !current.error &&
      !current.uncertain &&
      (!current.job || current.job.status === "FAILED") &&
      !operations.busyDraftIds.includes(draft.id) &&
      !operations.approvingIds.includes(draft.id)
    );
  };

  async function run(
    draft: Draft,
    action: "read" | "reconcile" | "submit",
    payload?: GenerationRequest,
  ) {
    const id = draft.id;
    const scopeKey = key(id);
    if (
      (action === "submit" && !collection.isCurrentBusiness()) ||
      draft.business_id !== businessId ||
      locks.current.has(scopeKey)
    )
      return;
    // Recovery uses the same exclusive lock as submission, but never owns
    // edit/reject/delete flags. An existing job may retain its own lock.
    if (
      operations.approvingIds.includes(id) ||
      operations.publishingIds.includes(id)
    )
      return;
    if (action === "submit") {
      if (
        operations.imageLocks.current.has(id) ||
        !payload ||
        !payload.avatar_id ||
        !payload.voice_id ||
        !payload.script.trim() ||
        payload.script.length > 5000 ||
        !canGenerate(draft) ||
        submitted.current.has(scopeKey)
      )
        return;
      if (
        !window.confirm(
          "¿Generar este video con HeyGen? Esta acción consume créditos de API y puede tener un costo. No se aprobará ni publicará automáticamente.",
        )
      )
        return;
    }
    if (!operations.acquireHeyGenLock(id, owner.current)) {
      setStates((current) => ({
        ...current,
        [scopeKey]: {
          ...(current[scopeKey] ?? empty),
          error:
            "Espera a que termine la otra operación del borrador antes de recuperar el video.",
        },
      }));
      return;
    }
    locks.current.add(scopeKey);
    setStates((current) => ({
      ...current,
      [scopeKey]: {
        ...(current[scopeKey] ?? empty),
        busy: true,
        error: null,
        ...(action === "submit" ? { uncertain: true } : {}),
      },
    }));
    if (action === "submit") {
      submitted.current.add(scopeKey);
      retained.current.add(scopeKey);
    }
    try {
      const job =
        action === "submit"
          ? await submitGeneration(businessId, id, payload!)
          : action === "reconcile"
            ? await reconcileGeneration(businessId, id)
            : await getGeneration(businessId, id);
      // Only an authoritative attempt can resolve an ambiguous submission.
      if (job?.status === "FAILED") submitted.current.delete(scopeKey);
      // Retain the owned lock for unresolved jobs, including a failed draft
      // refresh. Terminal recovery releases it only after applying fresh data.
      if (job) retained.current.add(scopeKey);
      const terminal =
        job?.status === "FAILED" ||
        (job?.status === "COMPLETED" && job.storage_status === "STORED");
      const release = () => {
        if (terminal) retained.current.delete(scopeKey);
      };
      if (!collection.isCurrentBusiness()) {
        release();
        return;
      }
      setStates((current) => ({
        ...current,
        [scopeKey]: {
          checked: true,
          busy: true,
          job,
          uncertain: !job && submitted.current.has(scopeKey),
          error: null,
        },
      }));
      if (job) {
        const drafts = await getDrafts(businessId, true);
        if (!collection.isCurrentBusiness()) {
          release();
          return;
        }
        const updated = drafts.find(
          (item) => item.id === id && item.business_id === businessId,
        );
        if (updated) collection.updateLocalDraft(updated);
      }
      release();
    } catch (error) {
      if (collection.isCurrentBusiness())
        setStates((current) => ({
          ...current,
          [scopeKey]: {
            ...(current[scopeKey] ?? empty),
            error:
              error instanceof Error
                ? error.message
                : "No se pudo recuperar el estado. Comprueba la conexión.",
          },
        }));
    } finally {
      locks.current.delete(scopeKey);
      if (!retained.current.has(scopeKey))
        operations.releaseHeyGenLock(id, owner.current);
      // Clear operation flags even after switching businesses; never apply old data.
      setStates((current) => ({
        ...current,
        [scopeKey]: { ...(current[scopeKey] ?? empty), busy: false },
      }));
    }
  }
  return {
    state,
    canGenerate,
    read: (draft: Draft) => run(draft, "read"),
    reconcile: (draft: Draft) => run(draft, "reconcile"),
    generate: (draft: Draft, payload: GenerationRequest) =>
      run(draft, "submit", payload),
  };
}
export type HeyGenController = ReturnType<typeof useHeyGenGeneration>;
