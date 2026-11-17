import { useState, useEffect, useRef } from "react";
import {
  generateContent,
  updateDraft,
  deleteDraft,
  rejectDraft,
  type Draft,
} from "../../../services/draftsApi";
import type { Section } from "../../../components/Sidebar";
import type { DraftCollection } from "./useDraftCollection";
import type { DraftOperations } from "./useDraftOperations";
import { useLocalization } from "../../../app/useLocalization";
import type { Translate } from "../../../app/localization";
import { ApiError } from "../../../lib/apiClient";

const OVERSIZED_CONTEXT_DETAIL =
  "This AI request contains too much context. Shorten the request or conversation and try again.";
const INVALID_IDEMPOTENCY_DETAIL = "A valid idempotency key is required";
const SAFE_ERROR_CODES = new Set([
  "ai_entitlement_required",
  "ai_quota_exhausted",
  "ai_subscription_required",
  "invalid_input",
  "provider_rate_limited",
  "upstream_failure",
]);

function generationErrorMessage(error: unknown, translate: Translate): string {
  if (!(error instanceof ApiError)) return translate("draft.generationError");
  if (error.message === OVERSIZED_CONTEXT_DETAIL) {
    return translate("draft.generationContextTooLarge");
  }
  if (error.code === "ai_quota_exhausted") {
    return translate("draft.generationQuotaExceeded");
  }
  if (
    error.code === "ai_entitlement_required" ||
    error.code === "ai_subscription_required"
  ) {
    return translate("draft.generationAccessRequired");
  }
  if (error.code === "provider_rate_limited") {
    return translate("draft.generationProviderThrottled");
  }
  if (
    error.code === "invalid_input" ||
    error.message === INVALID_IDEMPOTENCY_DETAIL
  ) {
    return translate("draft.generationInvalidInput");
  }
  return translate("draft.generationError");
}

export function useDraftActions(
  selectedBusinessId: string,
  collection: DraftCollection,
  operations: DraftOperations,
  setActiveSection: (section: Section) => void,
) {
  const { t } = useLocalization();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const deleteLocks = useRef(new Set<string>());
  const {
    setApprovals,
    selectedBusinessRef,
    isCurrentBusiness,
    updateLocalDraft,
  } = collection;
  const {
    approvingIds,
    busyDraftIds,
    setBusyDraftIds,
    publishingIds,
    imageLocks,
    setApprovalError,
  } = operations;
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setGenerationError(null);
    setEditingId(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [selectedBusinessId]);
  const handleGenerateContent = async () => {
    if (!selectedBusinessId || generating) return;
    const businessId = selectedBusinessId;
    setGenerating(true);
    setGenerationError(null);
    try {
      const draft = await generateContent(businessId);
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setApprovals((current) => [draft, ...current]);
        setActiveSection("Aprobaciones");
      }
    } catch (error) {
      if (import.meta.env.DEV && error instanceof ApiError) {
        const safeCode =
          error.code && SAFE_ERROR_CODES.has(error.code)
            ? error.code
            : "unknown";
        const safeDetail =
          error.message === OVERSIZED_CONTEXT_DETAIL
            ? "context_too_large"
            : error.message === INVALID_IDEMPOTENCY_DETAIL
              ? "invalid_idempotency_key"
              : "unrecognized";
        console.warn("Valeria content generation failed", {
          status: error.status,
          code: safeCode,
          detail: safeDetail,
        });
      }
      if (isCurrentBusiness() && selectedBusinessRef.current === businessId) {
        setGenerationError(generationErrorMessage(error, tRef.current));
      }
    } finally {
      setGenerating(false);
    }
  };
  const startEditing = (draft: Draft) => {
    setApprovalError(null);
    setEditingId(draft.id);
    setEditTitle(draft.title);
    setEditCaption(draft.caption);
    setActiveSection("Aprobaciones");
  };
  const handleSaveEdit = async (id: string) => {
    if (!editTitle.trim() || !editCaption.trim()) {
      setApprovalError(t("draft.requiredFields"));
      return;
    }
    if (busyDraftIds.includes(id) || approvingIds.includes(id)) return;
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const updated = await updateDraft(id, {
        title: editTitle.trim(),
        caption: editCaption.trim(),
      });
      if (!isCurrentBusiness()) return;
      updateLocalDraft(updated);
      setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError(tRef.current("draft.saveError"));
    } finally {
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };
  const handleDelete = async (id: string) => {
    if (
      deleteLocks.current.has(id) ||
      busyDraftIds.includes(id) ||
      approvingIds.includes(id) ||
      publishingIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    if (
      !window.confirm(
        t("draft.deleteConfirm"),
      )
    )
      return;
    deleteLocks.current.add(id);
    setDeletingIds((current) => [...current, id]);
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const deleted = await deleteDraft(id);
      if (!isCurrentBusiness()) return;
      updateLocalDraft(deleted);
      if (editingId === id) setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError(
        tRef.current("draft.deleteError"),
      );
    } finally {
      deleteLocks.current.delete(id);
      setDeletingIds((current) => current.filter((value) => value !== id));
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };
  const handleReject = async (id: string) => {
    if (
      busyDraftIds.includes(id) ||
      approvingIds.includes(id) ||
      imageLocks.current.has(id)
    )
      return;
    if (
      !window.confirm(
        t("draft.rejectConfirm"),
      )
    )
      return;
    setBusyDraftIds((current) => [...current, id]);
    setApprovalError(null);
    try {
      const rejected = await rejectDraft(id);
      if (!isCurrentBusiness()) return;
      updateLocalDraft(rejected);
      if (editingId === id) setEditingId(null);
    } catch {
      if (!isCurrentBusiness()) return;
      setApprovalError(tRef.current("draft.rejectError"));
    } finally {
      setBusyDraftIds((current) => current.filter((value) => value !== id));
    }
  };

  return {
    generating,
    generationError,
    editingId,
    editTitle,
    editCaption,
    setEditTitle,
    setEditCaption,
    setEditingId,
    deletingIds,
    handleGenerateContent,
    startEditing,
    handleSaveEdit,
    handleDelete,
    handleReject,
  };
}
