import { supabase } from "../services/supabaseClient";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

/** Send one authenticated request to our backend and read its JSON response. */
export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
  fallbackError = "No se pudo completar la solicitud.",
): Promise<T> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error("Debes iniciar sesión.");

  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  // Callers serialize JSON and set its Content-Type. For FormData, leave that
  // header unset so the browser can include the correct multipart boundary.
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string" ? body.detail : fallbackError,
    );
  }

  // Network and JSON parsing errors propagate unchanged. Never retry here.
  return response.json() as Promise<T>;
}
