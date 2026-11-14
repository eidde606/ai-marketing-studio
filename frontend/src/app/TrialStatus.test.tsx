import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrialStatus from "./TrialStatus";
import { getBusinessEntitlement } from "../services/onboardingApi";

vi.mock("./localization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

vi.mock("../services/onboardingApi", () => ({
  getBusinessEntitlement: vi.fn(),
}));

afterEach(cleanup);

const entitlement = {
  status: "trialing" as const,
  provider_status: null,
  trial_started_at: "2026-01-01T00:00:00Z",
  trial_expires_at: "2026-01-15T00:00:00Z",
  days_remaining: 8,
  usage: {
    leo_generations: { used: 4, limit: 20 },
    sofia_requests: { used: 1, limit: 5 },
    heygen_generations: { used: 0, limit: 0 },
    campaigns: { used: 1, limit: 2 },
  },
  features: {
    leo_generation: true,
    sofia_requests: true,
    facebook_publishing: true,
    heygen_generation: false,
    campaign_creation: true,
  },
  subscription_management: "unavailable" as const,
};

describe("TrialStatus", () => {
  it("shows server-provided usage and available trial features", async () => {
    vi.mocked(getBusinessEntitlement).mockResolvedValue(entitlement);
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findByText("trial.daysRemaining")).toBeTruthy();
    expect(screen.getByText("trial.generationsUsed")).toBeTruthy();
    expect(screen.getByText("trial.sofiaUsed")).toBeTruthy();
    expect(screen.getByText("trial.heygenUsed")).toBeTruthy();
    expect(screen.getByText("trial.campaignsUsed")).toBeTruthy();
    expect(screen.getByText("trial.subscriptionUnavailable")).toBeTruthy();
  });

  it("offers a retry when entitlement status cannot be loaded", async () => {
    vi.mocked(getBusinessEntitlement)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(entitlement);
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findByText("trial.loadError")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await waitFor(() => {
      expect(screen.getByText("trial.daysRemaining")).toBeTruthy();
    });
  });
});
