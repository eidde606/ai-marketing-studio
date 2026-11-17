import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrialStatus from "./TrialStatus";
import { getBusinessEntitlement } from "../services/onboardingApi";

vi.mock("./useLocalization", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

vi.mock("../services/onboardingApi", () => ({
  getBusinessEntitlement: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const entitlement = {
  status: "trialing" as const,
  provider_status: null,
  trial_started_at: "2026-01-01T00:00:00Z",
  trial_expires_at: "2026-01-15T00:00:00Z",
  days_remaining: 8,
  usage: {
    leo_generations: { used: 4, limit: 20 },
    sofia_requests: { used: 1, limit: 5 },
    edian_analyses: { used: 1, limit: 5 },
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
const currentTrialEntitlement = {
  ...entitlement,
  usage: {
    ...entitlement.usage,
    leo_generations: { used: 0, limit: 20 },
    sofia_requests: { used: 0, limit: 5 },
    campaigns: { used: 0, limit: 2 },
  },
};

describe("TrialStatus", () => {
  it("shows server-provided usage and available trial features", async () => {
    vi.mocked(getBusinessEntitlement).mockResolvedValue(entitlement);
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findByText("trial.daysRemaining")).toBeTruthy();
    expect(screen.getAllByText("trial.feature.leo").length).toBe(2);
    expect(screen.getAllByText("trial.feature.sofia").length).toBe(2);
    expect(screen.getAllByText("trial.feature.heygen").length).toBe(2);
    expect(screen.getAllByText("trial.feature.campaigns").length).toBe(2);
    expect(screen.getByText("trial.feature.image")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(4);
    expect(screen.getByText("trial.notIncluded")).toBeTruthy();
    expect(screen.queryByText("0 / 0")).toBeNull();
    expect(screen.getAllByText("trial.featureStatus.limited").length).toBe(4);
    expect(screen.getAllByText("trial.feature.analytics")).toHaveLength(2);
    expect(screen.getByText("trial.subscriptionUnavailable")).toBeTruthy();
  });

  it("uses the server-returned limit instead of hardcoded trial allowances", async () => {
    vi.mocked(getBusinessEntitlement).mockResolvedValue({
      ...entitlement,
      usage: {
        ...entitlement.usage,
        sofia_requests: { used: 2, limit: 3 },
      },
    });
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findByText("2 / 3")).toBeTruthy();
  });

  it("shows current zero usage against the server allowances and marks Sebastián limited", async () => {
    vi.mocked(getBusinessEntitlement).mockResolvedValue(
      currentTrialEntitlement,
    );
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findByText("0 / 5")).toBeTruthy();
    expect(screen.getByText("0 / 20")).toBeTruthy();
    expect(screen.getByText("0 / 2")).toBeTruthy();
    const sofiaStatus = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("trial.feature.sofia"));
    expect(sofiaStatus).toBeTruthy();
    expect(
      within(sofiaStatus as HTMLElement).getByText(
        "trial.featureStatus.limited",
      ),
    ).toBeTruthy();
  });

  it("refreshes stale same-business entitlement data when the page regains focus", async () => {
    vi.mocked(getBusinessEntitlement)
      .mockResolvedValueOnce({
        ...currentTrialEntitlement,
        usage: {
          ...currentTrialEntitlement.usage,
          sofia_requests: { used: 0, limit: 0 },
        },
      })
      .mockResolvedValueOnce(currentTrialEntitlement);
    render(<TrialStatus businessId="business-1" />);

    expect(await screen.findAllByText("trial.notIncluded")).toHaveLength(2);
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText("0 / 5")).toBeTruthy();
    await waitFor(() =>
      expect(getBusinessEntitlement).toHaveBeenCalledTimes(2),
    );
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
