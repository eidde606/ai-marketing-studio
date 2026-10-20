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

export async function startFacebookConnection(
  businessId: string,
): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Debes iniciar sesión para conectar Facebook.");
  }

  const url = new URL(`${API_BASE_URL}/auth/facebook/start`);
  url.searchParams.set("business_id", businessId);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error("No se pudo iniciar la conexión con Facebook.");
  }

  const data: { authorization_url: string } = await response.json();

  return data.authorization_url;
}

export type FacebookHandoff = {
  business_id: string;
  pages: FacebookPage[];
};

export type FacebookConnectionResult = {
  status: string;
  business_id: string;
  page_id: string;
  page_name: string;
};

async function getFacebookAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Debes iniciar sesión.");
  }

  return session.access_token;
}

export async function getFacebookHandoff(
  handoffToken: string,
): Promise<FacebookHandoff> {
  const accessToken = await getFacebookAccessToken();

  const response = await fetch(`${API_BASE_URL}/auth/facebook/handoff`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      handoff_token: handoffToken,
    }),
  });

  if (!response.ok) {
    throw new Error("La conexión con Facebook expiró o no es válida.");
  }

  return response.json() as Promise<FacebookHandoff>;
}

export async function selectFacebookPage(
  selectionToken: string,
  pageId: string,
): Promise<FacebookConnectionResult> {
  const accessToken = await getFacebookAccessToken();

  const response = await fetch(`${API_BASE_URL}/auth/facebook/select-page`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      selection_token: selectionToken,
      page_id: pageId,
    }),
  });

  if (!response.ok) {
    throw new Error("No se pudo conectar la página de Facebook.");
  }

  return response.json() as Promise<FacebookConnectionResult>;
}
