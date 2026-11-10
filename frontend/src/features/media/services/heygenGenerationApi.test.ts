import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getGeneration,
  reconcileGeneration,
  submitGeneration,
} from "./heygenGenerationApi";
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../../services/supabaseClient", () => ({ supabase: { auth } }));
beforeEach(() =>
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  }),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const body = {
  attempt_id: "attempt",
  business_id: "business/1",
  draft_id: "draft/1",
  status: "PROCESSING",
  storage_status: "PENDING",
};
it("uses only authenticated business-scoped endpoints and preserves the selected request payload", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
    );
  vi.stubGlobal("fetch", fetchMock);
  const payload = {
    avatar_id: "look",
    voice_id: "voice",
    script: "Guion revisado",
  };
  await submitGeneration("business/1", "draft/1", payload);
  await getGeneration("business/1", "draft/1");
  await reconcileGeneration("business/1", "draft/1");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const [submit, read, reconcile] = fetchMock.mock.calls;
  expect(submit[0]).toMatch(
    /\/businesses\/business%2F1\/drafts\/draft%2F1\/heygen-generation$/,
  );
  expect(submit[1]).toEqual({
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  expect(read[1].method).toBe("GET");
  expect(reconcile[0]).toMatch(/\/heygen-generation\/reconcile$/);
  expect(reconcile[1].body).toBeUndefined();
  expect(reconcile[1].method).toBe("POST");
});
it("distinguishes no attempt from an inaccessible draft", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ detail: "No HeyGen generation attempt found" }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Draft not found" }), {
          status: 404,
        }),
      ),
  );
  expect(await getGeneration("business/1", "draft/1")).toBeNull();
  await expect(getGeneration("business/1", "draft/1")).rejects.toThrow();
});
it("reports missing configuration and never retries a failed paid request", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    submitGeneration("business/1", "draft/1", {
      avatar_id: "look",
      voice_id: "voice",
      script: "Guion",
    }),
  ).rejects.toThrow("HeyGen no está configurado");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects foreign draft responses and unauthenticated requests", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(getGeneration("other-business", "draft/1")).rejects.toThrow(
    "no corresponde",
  );
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(getGeneration("business/1", "draft/1")).rejects.toThrow(
    "iniciar sesión",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
