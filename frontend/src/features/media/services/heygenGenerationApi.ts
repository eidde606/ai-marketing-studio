import { supabase } from "../../../services/supabaseClient";

export type GenerationRequest = {
  avatar_id: string;
  voice_id: string;
  script: string;
  confirmed_paid_generation?: boolean;
};
export type Generation = {
  attempt_id: string;
  draft_id: string;
  business_id: string;
  status: "SUBMITTING" | "UNKNOWN" | "PROCESSING" | "COMPLETED" | "FAILED";
  storage_status: "PENDING" | "PROCESSING" | "RETRY" | "STORED" | "FAILED";
};
const base =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

async function request(
  business: string,
  draft: string,
  action: "read" | "submit" | "reconcile",
  payload?: GenerationRequest,
): Promise<Generation | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error("Debes iniciar sesión.");
  const path = `/businesses/${encodeURIComponent(business)}/drafts/${encodeURIComponent(draft)}/heygen-generation`;
  const response = await fetch(
    base + path + (action === "reconcile" ? "/reconcile" : ""),
    {
      method: action === "read" ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    if (
      action !== "submit" &&
      response.status === 404 &&
      body.detail === "No HeyGen generation attempt found"
    )
      return null;
    if (response.status === 503)
      throw new Error("HeyGen no está configurado. Contacta al administrador.");
    if (response.status === 401 || response.status === 403)
      throw new Error("No tienes autorización para realizar esta acción.");
    if (response.status === 409)
      throw new Error(
        "Este borrador no permite generar otro video. Recupera su estado antes de continuar.",
      );
    if (response.status === 429)
      throw new Error(body.detail || "This business has reached its HeyGen generation allowance.");
    throw new Error(
      "No se pudo consultar HeyGen. Comprueba la conexión y recupera el estado; no vuelvas a generar.",
    );
  }
  const result = (await response.json()) as Generation;
  if (result.business_id !== business || result.draft_id !== draft)
    throw new Error("El video no corresponde a este borrador.");
  return result;
}
export const getGeneration = (business: string, draft: string) =>
  request(business, draft, "read");
export const reconcileGeneration = (business: string, draft: string) =>
  request(business, draft, "reconcile");
export const submitGeneration = (
  business: string,
  draft: string,
  payload: GenerationRequest,
) => request(business, draft, "submit", payload);
