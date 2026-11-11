import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Draft, ImageRevision } from "../../../services/draftsApi";

import type { HeyGenController } from "../../media/hooks/useHeyGenGeneration";

export type ApprovalPageProps = {
  heygen?: HeyGenController;
  handleDelete: (id: string) => Promise<void>;
  deletingIds: string[];
  businessId: string;
  draftDestinations: Record<string, { facebook: boolean; tiktok: boolean }>;

  setDraftDestinations: Dispatch<
    SetStateAction<Record<string, { facebook: boolean; tiktok: boolean }>>
  >;
  loadingDrafts: boolean;
  loadError: string | null;
  pendingCount: number;
  draftMessages: ReactNode;
  visibleDrafts: Draft[];
  approvingIds: string[];
  publishingIds: string[];
  busyDraftIds: string[];
  editingId: string | null;
  editTitle: string;
  editCaption: string;
  setEditTitle: Dispatch<SetStateAction<string>>;
  setEditCaption: Dispatch<SetStateAction<string>>;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  imageUrls: Record<string, string>;
  imageBusyIds: string[];
  imageErrors: Record<string, string>;
  imageInstructions: Record<string, string>;
  showImageEditor: Record<string, boolean>;
  revisions: Record<string, ImageRevision | null>;
  revisionBusyIds: string[];
  revisionErrors: Record<string, string>;
  formatDraftDate: (date: string) => string;
  handleApprove: (id: string) => Promise<void>;
  handlePublishFacebook: (id: string) => Promise<void>;
  handlePublishTikTok: (
    id: string,
    accountId: string,
    privacyLevel: string,
    interactions: {
      disable_comment: boolean;
      disable_duet: boolean;
      disable_stitch: boolean;
    },
  ) => Promise<void>;

  onVerifyTikTok: (id: string) => void;
  onVerifyFacebookVideo: (id: string) => void;
  handleReject: (id: string) => Promise<void>;
  handleSaveEdit: (id: string) => Promise<void>;
  handleGenerateImage: (draft: Draft) => Promise<void>;
  handlePreviewImage: (draft: Draft) => Promise<void>;
  handleCreateRevision: (draft: Draft) => Promise<void>;
  handleDecideRevision: (
    draft: Draft,
    decision: "accept" | "reject",
  ) => Promise<void>;
  refreshRevision: (draftId: string) => Promise<void>;
  addImageSuggestion: (draftId: string, suggestion: string) => void;
  updateImageInstructions: (draftId: string, value: string) => void;
  toggleImageEditor: (draftId: string) => void;
  startEditing: (draft: Draft) => void;
};
