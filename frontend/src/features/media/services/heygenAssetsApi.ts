import { supabase } from "../../../services/supabaseClient";

export type HeyGenAvatarType =
  | "studio_avatar"
  | "digital_twin"
  | "photo_avatar";
export type HeyGenOwnership = "private" | "public";
export type HeyGenVoiceType = "private" | "public";

export type HeyGenAvatarLook = {
  id: string;
  name: string;
  avatar_type: HeyGenAvatarType;
  default_voice_id: string | null;
  supported_api_engines: string[] | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  group_id: string | null;
  gender: string | null;
  tags: string[];
  status: string | null;
};

export type HeyGenVoice = {
  voice_id: string;
  name: string;
  language: string | null;
  status: string | null;
  mode: string | null;
  preview_audio_url: string | null;
};

export type HeyGenAssetPage<T> = {
  data: T[];
  has_more: boolean;
  next_token: string | null;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

async function getAssetPage<T>(
  path: string,
  params: URLSearchParams,
): Promise<HeyGenAssetPage<T>> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Debes iniciar sesión.");
  }

  const response = await fetch(`${API_BASE_URL}${path}?${params}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudieron cargar los recursos de HeyGen (${response.status}).`);
  }

  return response.json() as Promise<HeyGenAssetPage<T>>;
}

export function getHeyGenAvatarAssets(options: {
  avatarType?: HeyGenAvatarType;
  ownership: HeyGenOwnership;
  limit?: number;
  token?: string;
}): Promise<HeyGenAssetPage<HeyGenAvatarLook>> {
  const params = new URLSearchParams({
    ownership: options.ownership,
    limit: String(options.limit ?? 20),
  });
  if (options.avatarType) params.set("avatar_type", options.avatarType);
  if (options.token) params.set("token", options.token);
  return getAssetPage("/heygen/assets/avatars", params);
}

export function getHeyGenVoiceAssets(options: {
  type: HeyGenVoiceType;
  limit?: number;
  token?: string;
}): Promise<HeyGenAssetPage<HeyGenVoice>> {
  const params = new URLSearchParams({
    type: options.type,
    limit: String(options.limit ?? 20),
  });
  if (options.token) params.set("token", options.token);
  return getAssetPage("/heygen/assets/voices", params);
}
