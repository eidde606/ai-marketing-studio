import { apiRequest } from "../lib/apiClient";

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

function request<T>(
  businessId: string,
  path = "",
  options?: RequestInit,
): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set("Content-Type", "application/json");
  return apiRequest<T>(
    `/businesses/${encodeURIComponent(businessId)}/campaigns${path}`,
    { ...options, headers },
    "No se pudo completar la operación de campaña.",
  );
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
