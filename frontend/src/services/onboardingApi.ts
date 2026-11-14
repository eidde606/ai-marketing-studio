import { apiRequest } from "../lib/apiClient";
import type { Business, BusinessCreate } from "./businessesApi";
import type { Language } from "./accountApi";

export type OnboardingState = {
  current_step: number;
  business_profile: Partial<BusinessCreate>;
  interface_language: Language;
  conversation_language: Language;
  marketing_content_language: Language;
  social_accounts_skipped: boolean;
  completed: boolean;
  tutorial_completed: boolean;
  tutorial_step: number;
};

export type OnboardingInput = {
  current_step: number;
  business_profile?: Partial<BusinessCreate>;
  interface_language?: Language;
  conversation_language?: Language;
  marketing_content_language?: Language;
  social_accounts_skipped?: boolean;
};

export type BusinessEntitlement = {
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "canceled"
    | "expired"
    | "operator_granted"
    | "unavailable";
  provider_status: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  days_remaining: number | null;
  usage: Record<string, { used: number; limit: number }> | null;
  features: Record<string, boolean>;
  subscription_management: "unavailable";
};

export function getOnboarding(): Promise<OnboardingState> {
  return apiRequest<OnboardingState>("/account/onboarding");
}

export function saveOnboarding(
  input: OnboardingInput,
): Promise<OnboardingState> {
  return apiRequest<OnboardingState>("/account/onboarding", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function activateOnboarding(
  input: OnboardingInput & { business_profile: BusinessCreate },
): Promise<Business> {
  return apiRequest<Business>("/account/onboarding/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateTutorialCompletion(
  completed: boolean,
  currentStep?: number,
): Promise<{
  completed: boolean;
  current_step: number;
}> {
  return apiRequest<{ completed: boolean; current_step: number }>(
    "/account/onboarding/tutorial",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed, current_step: currentStep }),
    },
  );
}

export function getBusinessEntitlement(
  businessId: string,
): Promise<BusinessEntitlement> {
  return apiRequest<BusinessEntitlement>(
    `/businesses/${encodeURIComponent(businessId)}/entitlement`,
  );
}
