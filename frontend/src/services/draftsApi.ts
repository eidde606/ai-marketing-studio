import { supabase } from "./supabaseClient";

export type ImageStatus = "not_started" | "generating" | "completed" | "failed";

export type ImageRevisionStatus =
  "generating" | "ready" | "accepted" | "rejected" | "failed";

export type Draft = {
  id: string;
  title: string;
  caption: string;
  platform: string;
  publish_destinations: ("facebook" | "tiktok")[];
  status: string;
  facebook_post_id: string | null;
  tiktok_publish_id: string | null;
  tiktok_publish_status:
    "not_published" | "publishing" | "published" | "needs_review";
  facebook_publish_status:
    "not_published" | "publishing" | "published" | "needs_review";
  published_at: string | null;
  deleted_at: string | null;
  source: "manual" | "ai";
  created_at: string;
  business_id: string | null;
  campaign_id: string | null;
  video_script?: string | null;

  // AI image fields
  image_prompt: string | null;
  image_url: string | null;
  image_status: ImageStatus;
  media_type: "text" | "image" | "video";
  video_status:
    | "not_started"
    | "generating"
    | "uploading"
    | "completed"
    | "failed"
    | "needs_review";
  video_url: string | null;
};

export type DraftImageResponse = {
  draft_id: string;
  image_status: ImageStatus;
  image_url: string;
};

export type ImageRevision = {
  id: string;
  draft_id: string;
  instructions: string;
  status: ImageRevisionStatus;
  created_at: string;

  // Temporary signed Supabase URL.
  // Null while generating or if generation failed.
  image_url: string | null;
};

export type ImageRevisionDecisionResponse = {
  draft_id: string;
  revision_id: string;
  status: "accepted" | "rejected";
  image_url?: string;
  message?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const headers = new Headers(options?.headers);

  headers.set("Authorization", `Bearer ${session.access_token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const details = await response.text();

    throw new Error(
      `Request failed with status ${response.status}: ${
        details || "Unknown error"
      }`,
    );
  }

  return response.json() as Promise<T>;
}

// --------------------------------------------------
// Draft Management
// --------------------------------------------------

// Get drafts belonging to the selected business.
export function getDrafts(
  businessId: string,
  includeDeletedPublished = false,
): Promise<Draft[]> {
  return request<Draft[]>(
    `/drafts?business_id=${encodeURIComponent(businessId)}&include_deleted_published=${includeDeletedPublished}`,
  );
}

// Approve a pending draft.
export function approveDraft(id: string): Promise<Draft> {
  return request<Draft>(`/drafts/${encodeURIComponent(id)}/approve`, {
    method: "PATCH",
  });
}

export function updateDraftDestinations(
  id: string,
  destinations: ("facebook" | "tiktok")[],
): Promise<Draft> {
  return request<Draft>(`/drafts/${encodeURIComponent(id)}/destinations`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ destinations }),
  });
}

// Generate AI marketing content.
export function generateContent(
  businessId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<Draft> {
  return request<Draft>(
    `/businesses/${encodeURIComponent(businessId)}/generate-content`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    },
  );
}

export type FacebookPublishResponse = {
  status: "published" | "processing";
  facebook_post_id: string;
};

export function publishDraftToFacebook(
  id: string,
): Promise<FacebookPublishResponse> {
  return request<FacebookPublishResponse>(
    `/drafts/${encodeURIComponent(id)}/publish-facebook`,
    { method: "POST" },
  );
}

export type TikTokPublishRequest = {
  account_id: string;
  privacy_level: string;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
};

export type TikTokPublishResponse = {
  status: "processing";
  tiktok_publish_id: string;
};

export type TikTokVerificationResponse = {
  status: "published" | "failed" | "processing";
  tiktok_status?: string;
};

export type TikTokCreatorInfo = {
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
};

export type TikTokAccount = {
  id: string;
  account_name: string;
  connection_status: string;
};

export function getTikTokAccounts(
  businessId: string,
): Promise<{ accounts: TikTokAccount[] }> {
  return request<{ accounts: TikTokAccount[] }>(
    `/api/integrations/tiktok/accounts?business_id=${encodeURIComponent(businessId)}`,
  );
}

export function getTikTokCreatorInfo(
  id: string,
  accountId: string,
): Promise<TikTokCreatorInfo> {
  return request<TikTokCreatorInfo>(
    `/drafts/${encodeURIComponent(id)}/tiktok-creator-info?account_id=${encodeURIComponent(accountId)}`,
  );
}

export function publishDraftToTikTok(
  id: string,
  settings: TikTokPublishRequest,
): Promise<TikTokPublishResponse> {
  return request<TikTokPublishResponse>(
    `/drafts/${encodeURIComponent(id)}/publish-tiktok`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    },
  );
}

export function verifyTikTokPublication(
  id: string,
): Promise<TikTokVerificationResponse> {
  return request<TikTokVerificationResponse>(
    `/drafts/${encodeURIComponent(id)}/verify-tiktok`,
    {
      method: "POST",
    },
  );
}

// Edit a pending draft.
export function updateDraft(
  id: string,
  data: { title: string; caption: string },
): Promise<Draft> {
  return request<Draft>(`/drafts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

// Reject a pending draft.
export function rejectDraft(id: string): Promise<Draft> {
  return request<Draft>(`/drafts/${encodeURIComponent(id)}/reject`, {
    method: "PATCH",
  });
}

// --------------------------------------------------
// Original AI Image Generation
// --------------------------------------------------

// Generate an image for a pending draft.
// This endpoint makes a paid OpenAI API request.
export function generateDraftImage(id: string): Promise<DraftImageResponse> {
  return request<DraftImageResponse>(
    `/drafts/${encodeURIComponent(id)}/generate-image`,
    { method: "POST" },
  );
}

// Retrieve a temporary preview URL for an existing image.
// This does NOT generate a new image.
export function getDraftImage(id: string): Promise<DraftImageResponse> {
  return request<DraftImageResponse>(`/drafts/${encodeURIComponent(id)}/image`);
}

// --------------------------------------------------
// AI Image Revisions
// --------------------------------------------------

/**
 * Generate a revised image based on the original.
 *
 * Instructions may be written in Spanish.
 * This operation makes a PAID OpenAI API request.
 *
 * The original image is not replaced automatically.
 */
export function createImageRevision(
  draftId: string,
  instructions: string,
): Promise<ImageRevision> {
  const trimmedInstructions = instructions.trim();

  if (!trimmedInstructions) {
    return Promise.reject(
      new Error("Escribe las instrucciones para editar la imagen."),
    );
  }

  if (trimmedInstructions.length > 1000) {
    return Promise.reject(
      new Error("Las instrucciones no pueden superar 1000 caracteres."),
    );
  }

  return request<ImageRevision>(
    `/drafts/${encodeURIComponent(draftId)}/image-revisions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instructions: trimmedInstructions,
      }),
    },
  );
}

/**
 * Retrieve image revision history.
 *
 * Includes temporary signed URLs for available images.
 * Does not call the paid OpenAI image API.
 */
export function getImageRevisions(draftId: string): Promise<ImageRevision[]> {
  return request<ImageRevision[]>(
    `/drafts/${encodeURIComponent(draftId)}/image-revisions`,
  );
}

/**
 * Accept an edited image.
 *
 * The backend changes the draft's image reference
 * to the approved revision.
 *
 * The original file remains in private storage.
 */
export function acceptImageRevision(
  draftId: string,
  revisionId: string,
): Promise<ImageRevisionDecisionResponse> {
  return request<ImageRevisionDecisionResponse>(
    `/drafts/${encodeURIComponent(draftId)}/image-revisions/${encodeURIComponent(revisionId)}/accept`,
    {
      method: "POST",
    },
  );
}

/**
 * Reject an edited image.
 *
 * The original draft image remains unchanged.
 * This operation does not call the paid OpenAI image API.
 */
export function rejectImageRevision(
  draftId: string,
  revisionId: string,
): Promise<ImageRevisionDecisionResponse> {
  return request<ImageRevisionDecisionResponse>(
    `/drafts/${encodeURIComponent(draftId)}/image-revisions/${encodeURIComponent(revisionId)}/reject`,
    {
      method: "POST",
    },
  );
}

export type FacebookAnalytics = {
  draft_id: string;
  platform: string;
  post_id: string;
  reactions: number;
  comments: number;
  shares: number;
  permalink_url: string | null;
};

export function getFacebookAnalytics(
  draftId: string,
): Promise<FacebookAnalytics> {
  return request<FacebookAnalytics>(
    `/drafts/${encodeURIComponent(draftId)}/analytics/facebook`,
  );
}

export type FacebookReach = {
  unique_media_viewers: number | null;
};

export function getFacebookReach(draftId: string): Promise<FacebookReach> {
  return request<FacebookReach>(
    `/drafts/${encodeURIComponent(draftId)}/analytics/facebook/reach`,
  );
}

export function verifyFacebookVideo(
  id: string,
): Promise<FacebookPublishResponse> {
  return request<FacebookPublishResponse>(
    `/drafts/${encodeURIComponent(id)}/verify-facebook-video`,
    { method: "POST" },
  );
}

// Hide a draft while retaining its publication history.
export function deleteDraft(id: string): Promise<Draft> {
  return request<Draft>(`/drafts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
