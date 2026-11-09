import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignInput } from "./campaignsApi";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./supabaseClient", () => ({ supabase: { auth: { getSession } } }));

const fetchMock = vi.fn<typeof fetch>();
let api: typeof import("./campaignsApi");
const businessId = "negocio /á";
const campaignId = "campaña /1";
const root = `https://api.test.invalid/businesses/${encodeURIComponent(businessId)}/campaigns`;
const input: CampaignInput = {
  name: "Campaña de verano",
  objective: "Más visitas",
  status: "active",
  start_date: "2026-06-01",
  end_date: null,
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "  https://api.test.invalid  ");
  vi.stubGlobal("fetch", fetchMock);
  getSession.mockResolvedValue({
    data: { session: { access_token: "test-token" } },
    error: null,
  });
  api = await import("./campaignsApi");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function expectRequest(url: string, method?: string, body?: string) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [actualUrl, options] = fetchMock.mock.calls[0];
  expect(actualUrl).toBe(url);
  expect(options?.method).toBe(method);
  expect(options?.body).toBe(body);
  const headers = new Headers(options?.headers);
  expect(headers.get("Authorization")).toBe("Bearer test-token");
  expect(headers.get("Content-Type")).toBe(body ? "application/json" : null);
}

describe("campaign request contracts", () => {
  it("lists campaigns using the encoded business URL and unchanged JSON response", async () => {
    const response = [{ id: "campaign-1", progress: 25, drafts: [] }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)));
    expect(await api.getCampaigns(businessId)).toEqual(response);
    expectRequest(root);
  });

  it("creates a campaign with the exact JSON payload", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "new", ...input }), { status: 201 }),
    );
    expect(await api.createCampaign(businessId, input)).toEqual({
      id: "new",
      ...input,
    });
    expectRequest(root, "POST", JSON.stringify(input));
  });

  it("patches only supplied fields and keeps null date clearing", async () => {
    const changes = { name: "Nuevo nombre", start_date: null };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(changes)));
    expect(await api.updateCampaign(businessId, campaignId, changes)).toEqual(
      changes,
    );
    expectRequest(
      `${root}/${encodeURIComponent(campaignId)}`,
      "PATCH",
      JSON.stringify(changes),
    );
  });

  it("deletes with no request body and returns the server message", async () => {
    const response = { message: "Campaña eliminada correctamente." };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)));
    expect(await api.deleteCampaign(businessId, campaignId)).toEqual(response);
    expectRequest(`${root}/${encodeURIComponent(campaignId)}`, "DELETE");
  });

  it.each([true, false])(
    "preserves draft association URLs and methods (attach=%s)",
    async (attach) => {
      const draftId = "contenido /ñ";
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: campaignId })),
      );
      expect(
        await api.setCampaignDraft(businessId, campaignId, draftId, attach),
      ).toEqual({ id: campaignId });
      expectRequest(
        `${root}/${encodeURIComponent(campaignId)}/drafts/${encodeURIComponent(draftId)}`,
        attach ? "PATCH" : "DELETE",
      );
    },
  );
});

describe("existing campaign error behavior", () => {
  it.each([
    { data: { session: null }, error: null },
    { data: { session: { access_token: "" } }, error: null },
    {
      data: { session: { access_token: "test-token" } },
      error: new Error("Session error"),
    },
  ])(
    "rejects missing or failed authentication before fetching",
    async (session) => {
      getSession.mockResolvedValue(session);
      await expect(api.getCampaigns(businessId)).rejects.toThrow(
        "Debes iniciar sesión.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 404, 409, 422, 500])(
    "preserves string HTTP detail for status %s without retrying",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ detail: "Mensaje del servidor" }), {
          status,
        }),
      );
      await expect(api.getCampaigns(businessId)).rejects.toThrow(
        "Mensaje del servidor",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getSession).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    JSON.stringify({ detail: [{ msg: "Validation failed" }] }),
    JSON.stringify({ detail: null }),
    JSON.stringify({ message: "Other response shape" }),
    "null",
    "<html>Bad gateway</html>",
    "",
  ])(
    "uses the existing campaign fallback for an unusable error body (%s)",
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
      await expect(api.getCampaigns(businessId)).rejects.toThrow(
        "No se pudo completar la operación de campaña.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves an empty string detail instead of substituting a new message", async () => {
    fetchMock.mockResolvedValue(new Response('{"detail":""}', { status: 400 }));
    await expect(api.getCampaigns(businessId)).rejects.toMatchObject({
      message: "",
    });
  });

  it("propagates fetch network failures unchanged for listing", async () => {
    const failure = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(failure);
    await expect(api.getCampaigns(businessId)).rejects.toBe(failure);
    expect(failure.message).toBe("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the special deletion network error message and does not retry", async () => {
    const failure = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(failure);
    await expect(api.deleteCampaign(businessId, campaignId)).rejects.toBe(
      failure,
    );
    expect(failure.message).toBe(
      "No se pudo eliminar la campaña. Comprueba tu conexión e inténtalo de nuevo.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps backend deletion errors instead of replacing them with network text", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"detail":"Campaña no encontrada para este negocio."}', {
        status: 404,
      }),
    );
    await expect(api.deleteCampaign(businessId, campaignId)).rejects.toThrow(
      "Campaña no encontrada para este negocio.",
    );
  });

  it("continues to reject malformed successful JSON responses", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));
    await expect(api.getCampaigns(businessId)).rejects.toBeInstanceOf(
      SyntaxError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
