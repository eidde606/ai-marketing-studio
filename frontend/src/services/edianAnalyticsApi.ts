import { apiRequest } from "../lib/apiClient";

export type EdianAnalysis = {
  status: "ready" | "no_data" | "unavailable";
  locale: "en" | "es";
  source: "Facebook";
  posts_analyzed: number;
  observed: {
    platform: "Facebook";
    posts_analyzed: number;
    posts_with_any_data: number;
    metrics: Record<
      "reactions" | "comments" | "shares",
      { total: number | null; posts_with_data: number }
    >;
  } | null;
  interpretation: {
    summary: string;
    recommendations: string[];
  } | null;
  reused: boolean;
};

export function analyzeWithEdian(
  businessId: string,
  locale: "en" | "es",
  idempotencyKey: string,
): Promise<EdianAnalysis> {
  return apiRequest<EdianAnalysis>(
    `/businesses/${encodeURIComponent(businessId)}/analytics/edian`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale, idempotency_key: idempotencyKey }),
    },
    "Edian could not prepare recommendations.",
  );
}
