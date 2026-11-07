import { supabase } from "./supabaseClient";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

const BUSINESS_ID = "f33cccce-ec00-40ab-a90c-305d3b66d02c";

export async function testSofia(
  message = "Hola Sofía, quiero promocionar una crema facial en TikTok. ¿Qué me recomiendas?",
  conversationId: string | null = null,
) {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Please sign in first.");
  }

  const response = await fetch(
    `${API_BASE_URL}/businesses/${BUSINESS_ID}/sofia/chat`,
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Sofía returned ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  console.log("Sofía:", data.reply);
  console.log("Conversation ID:", data.conversation_id);

  return data;
}
