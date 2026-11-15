import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BillingPage from "./BillingPage";
import { getBillingOverview } from "../services/billingApi";

vi.mock("../app/localization", () => ({
  useLocalization: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, string | number>) =>
      key === "billing.days"
        ? `${values?.count} days`
        : values
          ? Object.entries(values).reduce(
              (text, [name, value]) => text.replace(`{${name}}`, String(value)),
              key,
            )
          : key,
  }),
}));

vi.mock("../services/billingApi", () => ({
  getBillingOverview: vi.fn(),
  createBillingCheckout: vi.fn(),
  createBillingPortal: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.resetAllMocks();
});

const trialOverview = {
  status: "trialing" as const,
  provider_status: null,
  trial_started_at: "2026-01-01T00:00:00Z",
  trial_expires_at: "2026-01-15T00:00:00Z",
  days_remaining: 8,
  current_period_end: null,
  cancel_at_period_end: false,
  usage: {
    businesses: { used: 1, limit: 1 },
    leo_generations: { used: 4, limit: 20 },
    sofia_requests: { used: 0, limit: 0 },
    campaigns: { used: 1, limit: 2 },
    heygen_generations: { used: 0, limit: 0 },
  },
  plan_name: "Monthly plan",
  price_display: null,
  checkout_available: false,
  portal_available: false,
  can_manage: true,
};

describe("BillingPage", () => {
  it("shows server-provided trial, usage, and a gated monthly upgrade", async () => {
    vi.mocked(getBillingOverview).mockResolvedValue(trialOverview);
    render(<BillingPage businessId="business-1" membershipRole="owner" />);

    expect(await screen.findAllByText("billing.status.trialing")).toHaveLength(
      2,
    );
    expect(screen.getByText("8 days")).toBeTruthy();
    expect(screen.getByText("billing.noCardTrial")).toBeTruthy();
    expect(screen.getByText("billing.usageTitle")).toBeTruthy();
    expect(screen.getByText("Monthly plan")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /billing.upgrade/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("billing.notConfigured")).toBeTruthy();
  });

  it("does not allow a member to manage an available subscription", async () => {
    vi.mocked(getBillingOverview).mockResolvedValue({
      ...trialOverview,
      checkout_available: true,
      can_manage: false,
    });
    render(<BillingPage businessId="business-1" membershipRole="member" />);

    expect(await screen.findByText("billing.adminOnly")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /billing.upgrade/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
