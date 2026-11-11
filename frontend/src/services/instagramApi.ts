import { supabase } from "./supabaseClient";

export type InstagramConnectionStatus =
  | "not_connected"
  | "linked_not_api_authorized"
  | "connected_and_authorized"
  | "reauthorization_required"
  | "permission_error"
  | "discovery_error";

export type InstagramConnection = {
  status: InstagramConnectionStatus;
  username: string | null;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  granted_permissions: string[];
  missing_permissions: string[];
  message: string | null;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Debes iniciar sesión para administrar Instagram.");
  }
  return session.access_token;
}

export async function getInstagramConnection(
  businessId: string,
): Promise<InstagramConnection> {
  const accessToken = await getAccessToken();
  const url = new URL(`${API_BASE_URL}/auth/instagram/accounts`);
  url.searchParams.set("business_id", businessId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("No se pudo verificar la conexión de Instagram.");
  }
  return (await response.json()) as InstagramConnection;
}

export async function startInstagramConnection(
  businessId: string,
): Promise<string> {
  const accessToken = await getAccessToken();
  const url = new URL(`${API_BASE_URL}/auth/instagram/start`);
  url.searchParams.set("business_id", businessId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    let message = "No se pudo iniciar la conexión con Instagram.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Use the safe localized fallback if the server response is not JSON.
    }
    throw new Error(message);
  }
  const body = (await response.json()) as { authorization_url?: unknown };
  if (typeof body.authorization_url !== "string") {
    throw new Error("Meta no devolvió una URL de autorización válida.");
  }
  return body.authorization_url;
}
