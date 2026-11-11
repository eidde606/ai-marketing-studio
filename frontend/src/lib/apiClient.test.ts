import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../services/supabaseClient", () => ({
  supabase: { auth: { getSession } },
}));

const fetchMock = vi.fn<typeof fetch>();
let apiRequest: typeof import("./apiClient").apiRequest;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", " https://api.test.invalid ");
  vi.stubGlobal("fetch", fetchMock);
  getSession.mockResolvedValue({
    data: { session: { access_token: "current-token" } },
    error: null,
  });
  fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
  ({ apiRequest } = await import("./apiClient"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("shared authenticated JSON response client", () => {
  it("uses the current token while preserving caller headers without mutating them", async () => {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: "Bearer stale-token",
    });
    expect(await apiRequest("/example", { headers })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test.invalid/example");
    const sent = new Headers(options?.headers);
    expect(sent.get("Authorization")).toBe("Bearer current-token");
    expect(sent.get("Accept")).toBe("application/json");
    expect(sent.has("Content-Type")).toBe(false);
    expect(headers.get("Authorization")).toBe("Bearer stale-token");
  });

  it("gets a fresh session for each request instead of caching tokens", async () => {
    await apiRequest("/first");
    getSession.mockResolvedValue({
      data: { session: { access_token: "next-token" } },
      error: null,
    });
    await apiRequest("/second");
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization"),
    ).toBe("Bearer next-token");
  });

  it("passes serialized JSON, method and abort signal through unchanged", async () => {
    const body = JSON.stringify({ name: "Campaña", end_date: null });
    const controller = new AbortController();
    await apiRequest("/example", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const options = fetchMock.mock.calls[0][1];
    expect(options?.method).toBe("PATCH");
    expect(options?.body).toBe(body);
    expect(options?.signal).toBe(controller.signal);
    expect(new Headers(options?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("passes FormData untouched without forcing JSON or a multipart Content-Type", async () => {
    const body = new FormData();
    body.append(
      "file",
      new File(["test bytes"], "test.mp4", { type: "video/mp4" }),
    );
    await apiRequest("/example-upload", { method: "POST", body });
    const options = fetchMock.mock.calls[0][1];
    expect(options?.body).toBe(body);
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).has("Content-Type")).toBe(false);
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer current-token",
    );
  });

  it.each([undefined, "", "   "])(
    "retains the localhost fallback when the base URL is %s",
    async (baseUrl) => {
      vi.stubEnv("VITE_API_BASE_URL", baseUrl);
      vi.resetModules();
      const { apiRequest: request } = await import("./apiClient");
      await request("/example");
      expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/example");
    },
  );

  it.each([
    { data: { session: null }, error: null },
    { data: { session: { access_token: "" } }, error: null },
    {
      data: { session: { access_token: "current-token" } },
      error: new Error("Session unavailable"),
    },
  ])(
    "stops before fetch when authentication is unavailable",
    async (session) => {
      getSession.mockResolvedValue(session);
      await expect(apiRequest("/example")).rejects.toThrow(
        "Debes iniciar sesión.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("propagates session lookup rejection without fetching or retrying", async () => {
    const failure = new Error("Session lookup failed");
    getSession.mockRejectedValue(failure);
    await expect(apiRequest("/example")).rejects.toBe(failure);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses string backend detail and does not retry HTTP failures", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"detail":"Acceso denegado"}', { status: 403 }),
    );
    await expect(apiRequest("/example")).rejects.toThrow("Acceso denegado");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the supplied fallback when an HTTP error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    await expect(
      apiRequest("/example", undefined, "Error de esta función."),
    ).rejects.toThrow("Error de esta función.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("has a generic fallback for callers without a feature-specific message", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(apiRequest("/example")).rejects.toThrow(
      "No se pudo completar la solicitud.",
    );
  });

  it("propagates the same network error without wrapping or retrying", async () => {
    const failure = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(failure);
    await expect(apiRequest("/example")).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves JSON parse failure for successful empty responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest("/example")).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
