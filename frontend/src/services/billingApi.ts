import { apiRequest } from "../lib/apiClient";

export type BillingOverview = {
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
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  usage: Record<string, { used: number; limit: number }> | null;
  plan_name: string;
  price_display: string | null;
  checkout_available: boolean;
  portal_available: boolean;
  can_manage: boolean;
};

function businessPath(businessId: string) {
  return `/businesses/${encodeURIComponent(businessId)}/billing`;
}

export function getBillingOverview(
  businessId: string,
): Promise<BillingOverview> {
  return apiRequest<BillingOverview>(businessPath(businessId));
}

export function createBillingCheckout(
  businessId: string,
): Promise<{ url: string }> {
  return apiRequest<{ url: string }>(`${businessPath(businessId)}/checkout`, {
    method: "POST",
  });
}

export function createBillingPortal(
  businessId: string,
): Promise<{ url: string }> {
  return apiRequest<{ url: string }>(`${businessPath(businessId)}/portal`, {
    method: "POST",
  });
}
