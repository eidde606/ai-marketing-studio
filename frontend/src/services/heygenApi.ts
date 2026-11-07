import { supabase } from "./supabaseClient";

export type HeyGenAvatar = {
  id: string;
  name: string;
  avatar_type?: string;
  default_voice_id?: string;
  preview_image_url?: string;
};

export interface HeyGenVideoRequest {
  avatar_id: string;
  voice_id: string;
  script: string;
}

export interface HeyGenVideoJob {
  video_id: string;
}

export interface HeyGenVideoStatus {
  status: string;
  video_url?: string;
  error?: string;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";

// Retrieve the current user's access token
async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw new Error("Authentication required. Please sign in.");
  }

  return session.access_token;
}

// Retrieve available HeyGen avatars
export async function getHeyGenAvatars(): Promise<HeyGenAvatar[]> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}/heygen/avatars`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to retrieve HeyGen avatars (${response.status}).`);
  }

  return response.json() as Promise<HeyGenAvatar[]>;
}

// Submit a video generation request
export async function generateHeyGenVideo(
  request: HeyGenVideoRequest,
): Promise<HeyGenVideoJob> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}/heygen/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Unable to generate HeyGen video (${response.status}).`);
  }

  return response.json() as Promise<HeyGenVideoJob>;
}

// Generate a HeyGen video associated with a specific Draft
export async function generateDraftVideo(
  draftId: string,
  request: HeyGenVideoRequest,
): Promise<HeyGenVideoJob> {
  const token = await getAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/drafts/${encodeURIComponent(draftId)}/generate-video`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to generate Draft video (${response.status}).`);
  }

  return response.json() as Promise<HeyGenVideoJob>;
}

// Check the status of a submitted video
export async function getHeyGenVideoStatus(
  videoId: string,
): Promise<HeyGenVideoStatus> {
  const token = await getAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/heygen/videos/${encodeURIComponent(videoId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to retrieve video status (${response.status}).`);
  }

  return response.json() as Promise<HeyGenVideoStatus>;
}
