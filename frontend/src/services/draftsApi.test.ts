import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("./supabaseClient", () => ({
  supabase: { auth: { getSession } },
}));

import { ApiError } from "../lib/apiClient";
import { generateContent } from "./draftsApi";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  getSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateContent", () => {
  it("uses the independent endpoint with its idempotency key", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "draft-1" }), { status: 201 }),
    );

    await expect(
      generateContent("business-1", "generation-key"),
    ).resolves.toEqual({
      id: "draft-1",
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/businesses/business-1/generate-content");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(
      JSON.stringify({ idempotency_key: "generation-key" }),
    );
  });

  it("preserves the safe validation detail and error code from HTTP 400", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail:
            "This AI request contains too much context. Shorten the request or conversation and try again.",
        }),
        {
          status: 400,
          headers: { "X-Error-Code": "invalid_input" },
        },
      ),
    );

    await expect(
      generateContent("business-1", "generation-key"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "invalid_input",
      message:
        "This AI request contains too much context. Shorten the request or conversation and try again.",
    } satisfies Partial<ApiError>);
  });
});
