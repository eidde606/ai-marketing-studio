import { apiRequest } from "../lib/apiClient";

export type Language = "en" | "es";

export type AccountPreferences = {
  interface_language: Language;
  conversation_language: Language;
};

export type BusinessPreferences = {
  marketing_content_language: Language;
};

export type BusinessAccess = {
  id: string;
  name: string;
  membership_id: string;
  role: "owner" | "admin" | "member";
  capabilities: string[];
};

export type FeatureAvailability = {
  public_registration: boolean;
  facebook_publishing: boolean;
  tiktok_direct_publishing: boolean;
  tiktok_manual_export: boolean;
  instagram_publishing: boolean;
  instagram_connection: boolean;
  mia_analysis: boolean;
  scheduling: boolean;
};

export type AccountResponse = {
  user_id: string;
  preferences: AccountPreferences;
  businesses: BusinessAccess[];
  features: FeatureAvailability;
};

export type HeyGenUsage = {
  business_id: string;
  configured: boolean;
  limits: {
    max_generations: number;
    max_script_characters: number;
    max_concurrent_jobs: number;
  } | null;
  attempts_used: number;
  active_jobs: number;
  remaining_generations: number;
  period: "lifetime";
  unit: "generation_attempts";
};

export function getAccount(): Promise<AccountResponse> {
  return apiRequest<AccountResponse>("/account");
}

export function updateAccountPreferences(
  preferences: Partial<AccountPreferences>,
): Promise<AccountPreferences> {
  return apiRequest<AccountPreferences>("/account/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
}

export function getBusinessPreferences(
  businessId: string,
): Promise<BusinessPreferences> {
  return apiRequest<BusinessPreferences>(
    `/businesses/${encodeURIComponent(businessId)}/preferences`,
  );
}

export function updateBusinessPreferences(
  businessId: string,
  preferences: BusinessPreferences,
): Promise<BusinessPreferences> {
  return apiRequest<BusinessPreferences>(
    `/businesses/${encodeURIComponent(businessId)}/preferences`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    },
  );
}

export function getHeyGenUsage(businessId: string): Promise<HeyGenUsage> {
  return apiRequest<HeyGenUsage>(
    `/businesses/${encodeURIComponent(businessId)}/heygen/usage`,
  );
}
