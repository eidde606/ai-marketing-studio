import { afterEach, describe, expect, it, vi } from "vitest";
import { getBusinessEntitlement } from "./onboardingApi";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiRequest: mocks.apiRequest,
}));

afterEach(() => {
  vi.resetAllMocks();
});

describe("getBusinessEntitlement", () => {
  it("requests fresh, uncached entitlement data for the selected business", async () => {
    mocks.apiRequest.mockResolvedValue({ status: "trialing" });

    await getBusinessEntitlement("business/a");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/businesses/business%2Fa/entitlement",
      { cache: "no-store" },
    );
  });
});
