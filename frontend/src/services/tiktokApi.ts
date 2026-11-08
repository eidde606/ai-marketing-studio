import { supabase } from "./supabaseClient";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export type ConnectedTikTokAccount = {
  id?: string;
  account_name?: string;
  display_name?: string;
  platform_account_id?: string;
  connection_status?: string;
};

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Debes iniciar sesión para conectar TikTok.");
  }
  return session.access_token;
}

export async function startTikTokConnection(
  businessId: string,
): Promise<string> {
  const token = await getAccessToken();
  const url = new URL(`${API_BASE_URL}/api/integrations/tiktok/start`);
  url.searchParams.set("business_id", businessId);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(`No se pudo iniciar TikTok (${response.status}).`);
  const data: { authorization_url: string } = await response.json();
  return data.authorization_url;
}

export async function getConnectedTikTokAccounts(
  businessId: string,
): Promise<ConnectedTikTokAccount[]> {
  const token = await getAccessToken();
  const url = new URL(`${API_BASE_URL}/api/integrations/tiktok/accounts`);
  url.searchParams.set("business_id", businessId);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error(`No se pudo verificar TikTok (${response.status}).`);
  const data:
    { accounts: ConnectedTikTokAccount[] } | ConnectedTikTokAccount[] =
    await response.json();
  return Array.isArray(data) ? data : data.accounts;
}
