import { supabase } from "./supabaseClient";

export type CampaignStatus =
  "draft" | "active" | "paused" | "completed" | "archived";
export type CampaignInput = {
  name: string;
  objective: string;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
};
export type Campaign = CampaignInput & {
  id: string;
  business_id: string;
  created_at: string;
  updated_at: string;
  total_count: number;
  published_count: number;
  pending_count: number;
  rejected_count: number;
  progress: number;
  drafts: {
    id: string;
    title: string;
    status: string;
    platform: string;
    published: boolean;
    deleted_at: string | null;
  }[];
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

async function request<T>(
  businessId: string,
  path = "",
  options?: RequestInit,
): Promise<T> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Debes iniciar sesión.");
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(
    `${API_BASE_URL}/businesses/${encodeURIComponent(businessId)}/campaigns${path}`,
    { ...options, headers },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : "No se pudo completar la operación de campaña.",
    );
  }
  return response.json() as Promise<T>;
}

export const getCampaigns = (businessId: string) =>
  request<Campaign[]>(businessId);
export const createCampaign = (businessId: string, input: CampaignInput) =>
  request<Campaign>(businessId, "", {
    method: "POST",
    body: JSON.stringify(input),
  });
export const updateCampaign = (
  businessId: string,
  id: string,
  input: Partial<CampaignInput>,
) =>
  request<Campaign>(businessId, `/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
export const deleteCampaign = async (businessId: string, id: string) => {
  try {
    return await request<{ message: string }>(
      businessId,
      `/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      error.message =
        "No se pudo eliminar la campaña. Comprueba tu conexión e inténtalo de nuevo.";
    }
    throw error;
  }
};
export const setCampaignDraft = (
  businessId: string,
  campaignId: string,
  draftId: string,
  associate: boolean,
) =>
  request<Campaign>(
    businessId,
    `/${encodeURIComponent(campaignId)}/drafts/${encodeURIComponent(draftId)}`,
    {
      method: associate ? "PATCH" : "DELETE",
    },
  );
