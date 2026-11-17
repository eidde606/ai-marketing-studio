import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../lib/apiClient", () => ({ apiRequest: mocks.apiRequest }));

import { analyzeWithEdian } from "./edianAnalyticsApi";

afterEach(() => vi.resetAllMocks());

describe("edianAnalyticsApi", () => {
  it("uses the selected business and sends locale plus caller idempotency key", async () => {
    mocks.apiRequest.mockResolvedValue({ status: "no_data" });

    await analyzeWithEdian("business/one", "es", "request-key-123");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/businesses/business%2Fone/analytics/edian",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: "es",
          idempotency_key: "request-key-123",
        }),
      },
      "Edian could not prepare recommendations.",
    );
  });
});
