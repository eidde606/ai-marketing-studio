import { supabase } from "../../../services/supabaseClient";

// Preserve the existing preview/download error messages and request order.
export async function fetchVideoPreview(
  draftId: string,
): Promise<{ video_url: string }> {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Debes iniciar sesión.");
  }

  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

  const response = await fetch(
    `${apiBaseUrl}/drafts/${encodeURIComponent(draftId)}/video-preview`,
    {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`No se pudo cargar el video (${response.status}).`);
  }

  const result: { video_url: string } = await response.json();

  if (!result.video_url) {
    throw new Error("No se recibió la URL del video.");
  }

  return result;
}

export async function fetchVideoDownload(draftId: string): Promise<Blob> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Debes iniciar sesión.");
  }
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
  const response = await fetch(
    `${apiBaseUrl}/drafts/${encodeURIComponent(draftId)}/video-preview`,
    { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  );
  if (!response.ok) throw new Error("No se pudo obtener el video.");
  const result: { video_url: string } = await response.json();
  if (!result.video_url) throw new Error("No se encontró el video.");

  // Fetch the signed Supabase URL and save it as a local MP4 file.
  const videoResponse = await fetch(result.video_url);
  if (!videoResponse.ok) throw new Error("No se pudo descargar el video.");
  const blob = await videoResponse.blob();
  return blob;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

export async function uploadDraftVideo(
  draftId: string,
  file: File,
): Promise<void> {
  const { data, error: authError } = await supabase.auth.getSession();

  if (authError || !data.session?.access_token) {
    throw new Error("Debes iniciar sesión.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${API_BASE_URL}/drafts/${encodeURIComponent(draftId)}/upload-video`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(`No se pudo subir el video (${response.status}).`);
  }
}
