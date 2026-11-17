import { supabase } from "./supabaseClient";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export type SofiaChatResponse = {
  conversation_id: string;
  reply: string;
};

export type SofiaApiErrorCode =
  | "ai_entitlement_required"
  | "ai_subscription_required"
  | "ai_quota_exhausted"
  | "provider_rate_limited"
  | "invalid_input"
  | "unprocessable_entity"
  | "not_found"
  | "conflict"
  | "upstream_failure"
  | "unavailable"
  | "forbidden"
  | "unauthenticated"
  | "limit_exceeded";

export type SofiaApiErrorDetail =
  | "conversation_instructions_missing"
  | "context_too_large"
  | "invalid_idempotency_key"
  | "ai_entitlement_required"
  | "ai_subscription_required"
  | "ai_quota_exhausted"
  | null;

const errorCodes: SofiaApiErrorCode[] = [
  "ai_entitlement_required",
  "ai_subscription_required",
  "ai_quota_exhausted",
  "provider_rate_limited",
  "invalid_input",
  "unprocessable_entity",
  "not_found",
  "conflict",
  "upstream_failure",
  "unavailable",
  "forbidden",
  "unauthenticated",
  "limit_exceeded",
];

const errorDetails = new Map<string, Exclude<SofiaApiErrorDetail, null>>([
  [
    "The conversation has no campaign instructions",
    "conversation_instructions_missing",
  ],
  [
    "This AI request contains too much context. Shorten the request or conversation and try again.",
    "context_too_large",
  ],
  ["A valid idempotency key is required", "invalid_idempotency_key"],
  [
    "An active trial or subscription is required to use AI features.",
    "ai_entitlement_required",
  ],
  [
    "Your subscription does not allow AI usage. Review billing options to continue.",
    "ai_subscription_required",
  ],
  ["This trial usage allowance is exhausted", "ai_quota_exhausted"],
]);

function safeErrorCode(value: string | null): SofiaApiErrorCode | null {
  if (!value) return null;
  return errorCodes.find((code) => code === value) ?? null;
}

function safeErrorDetail(value: unknown): SofiaApiErrorDetail {
  if (typeof value !== "string") return null;
  return errorDetails.get(value) ?? null;
}

async function parseSofiaApiError(
  response: Response,
): Promise<SofiaApiError> {
  const payload: unknown = await response.json().catch(() => null);
  const rawDetail =
    typeof payload === "object" &&
    payload !== null &&
    "detail" in payload
      ? payload.detail
      : null;

  return new SofiaApiError(
    response.status,
    safeErrorCode(response.headers.get("X-Error-Code")),
    safeErrorDetail(rawDetail),
  );
}

export class SofiaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: SofiaApiErrorCode | null = null,
    readonly detail: SofiaApiErrorDetail = null,
  ) {
    super("Sebastián request failed");
    this.name = "SofiaApiError";
  }
}

export async function sendMessageToSofia(
  businessId: string,
  message: string,
  conversationId: string | null = null,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<SofiaChatResponse> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/sofia/chat`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        idempotency_key: idempotencyKey,
      }),
    },
  );

  if (!response.ok) {
    throw await parseSofiaApiError(response);
  }

  return (await response.json()) as SofiaChatResponse;
}

export type SofiaMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SofiaConversation = {
  conversation_id: string;
  messages: SofiaMessage[];
};

export async function getLatestSofiaConversation(
  businessId: string,
): Promise<SofiaConversation | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/sofia/conversation/latest`,
    {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load Sebastián's conversation: ${response.status}`);
  }

  return (await response.json()) as SofiaConversation | null;
}

export type SofiaGeneratedDraft = {
  id: string;
  business_id: string;
  title: string;
  caption: string;
  platform: string;
  status: string;
  video_script?: string | null;
};

export async function generateDraftWithLeo(
  businessId: string,
  conversationId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<SofiaGeneratedDraft> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/sofia/conversations/${encodeURIComponent(conversationId)}/generate-draft`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    },
  );

  if (!response.ok) {
    throw await parseSofiaApiError(response);
  }

  return (await response.json()) as SofiaGeneratedDraft;
}

export type SofiaConversationSummary = {
  id: string;
  created_at: string;
  title?: string;
};

export async function getSofiaConversations(
  businessId: string,
): Promise<SofiaConversationSummary[]> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/sofia/conversations`,
    {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load conversations: ${response.status}`);
  }

  return (await response.json()) as SofiaConversationSummary[];
}

export async function getSofiaConversation(
  businessId: string,
  conversationId: string,
): Promise<SofiaConversation> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/sofia/conversations/${encodeURIComponent(conversationId)}`,
    {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load conversation: ${response.status}`);
  }

  return (await response.json()) as SofiaConversation;
}
