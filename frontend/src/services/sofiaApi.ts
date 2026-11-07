import { supabase } from "./supabaseClient";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export type SofiaChatResponse = {
  conversation_id: string;
  reply: string;
};

export async function sendMessageToSofia(
  businessId: string,
  message: string,
  conversationId: string | null = null,
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
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Sofía request failed: ${response.status}`);
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
    throw new Error(`Failed to load Sofía's conversation: ${response.status}`);
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
      },
    },
  );

  if (!response.ok) {
    throw new Error(`No se pudo generar el borrador: ${response.status}`);
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
