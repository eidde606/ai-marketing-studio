import { supabase } from "./supabaseClient";

export type FacebookPage = {
  id: string;
  name: string;
};

export class FacebookApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FacebookApiError";
  }
}

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

export type ConnectedFacebookAccount = {
  id: string;
  platform: string;
  page_id: string;
  page_name: string;
  connection_status: string;
};

async function getFacebookAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new FacebookApiError("Debes iniciar sesión.", 401);
  }

  return session.access_token;
}

export async function getFacebookHandoff(
  handoffToken: string,
  businessId: string,
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
      business_id: businessId,
    }),
  });

  if (!response.ok) {
    throw new FacebookApiError(
      "La conexión con Facebook expiró o no es válida.",
      response.status,
    );
  }

  return response.json() as Promise<FacebookHandoff>;
}

export async function selectFacebookPage(
  selectionToken: string,
  businessId: string,
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
      business_id: businessId,
      page_id: pageId,
    }),
  });

  if (!response.ok) {
    throw new FacebookApiError(
      "No se pudo conectar la página de Facebook.",
      response.status,
    );
  }

  return response.json() as Promise<FacebookConnectionResult>;
}

export async function getConnectedFacebookAccounts(
  businessId: string,
): Promise<ConnectedFacebookAccount[]> {
  const accessToken = await getFacebookAccessToken();

  const url = new URL(`${API_BASE_URL}/auth/facebook/accounts`);
  url.searchParams.set("business_id", businessId);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("No se pudieron recuperar las cuentas de Facebook.");
  }

  const data: { accounts: ConnectedFacebookAccount[] } = await response.json();

  return data.accounts;
}

export async function disconnectFacebookAccount(
  businessId: string,
  accountId: string,
): Promise<void> {
  const accessToken = await getFacebookAccessToken();
  const url = new URL(
    `${API_BASE_URL}/auth/facebook/accounts/${encodeURIComponent(accountId)}`,
  );
  url.searchParams.set("business_id", businessId);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("Unable to disconnect Facebook Page");
  }
}
