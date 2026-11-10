import { afterEach, expect, it, vi } from "vitest";
import {
  getHeyGenAvatarAssets,
  getHeyGenVoiceAssets,
} from "./heygenAssetsApi";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../../services/supabaseClient", () => ({
  supabase: { auth },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the authenticated backend and sends avatar filters and cursor", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "test-access-token" } },
    error: null,
  });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ data: [], has_more: false, next_token: null }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await getHeyGenAvatarAssets({
    avatarType: "photo_avatar",
    ownership: "private",
    token: "next/page",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(
      "/heygen/assets/avatars?ownership=private&limit=20&avatar_type=photo_avatar&token=next%2Fpage",
    ),
    {
      headers: { Authorization: "Bearer test-access-token" },
    },
  );
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("X-Api-Key");
});

it("uses v3 voice type and reports backend failures", async () => {
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "test-access-token" } },
    error: null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("unavailable", { status: 502 })),
  );

  await expect(getHeyGenVoiceAssets({ type: "public" })).rejects.toThrow(
    "No se pudieron cargar los recursos de HeyGen (502).",
  );
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/heygen/assets/voices?type=public&limit=20"),
    expect.any(Object),
  );
});
