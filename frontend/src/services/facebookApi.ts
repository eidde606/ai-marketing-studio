import { supabase } from "./supabaseClient";

export type FacebookPage = {
  id: string;
  name: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export async function getFacebookPage(): Promise<FacebookPage> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  const response = await fetch(`${API_BASE_URL}/facebook/page`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Facebook connection failed (${response.status})`);
  }

  return response.json() as Promise<FacebookPage>;
}
