import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BillingPage from "./BillingPage";
import {
  createBillingPortal,
  getBillingOverview,
} from "../services/billingApi";

vi.mock("../app/useLocalization", () => ({
  useLocalization: () => ({
    locale: "en",
    t: (key: string, values?: Record<string, string | number>) =>
      key === "billing.days"
        ? `${values?.count} days`
        : key === "billing.noRefundCheckout"
          ? "All subscription payments are non-refundable, except where required by applicable law."
          : key === "billing.subscriptionPolicy"
            ? "Read the Subscription & Cancellation Policy"
            : key === "billing.cancelScheduled"
              ? `Stripe confirms cancellation for ${values?.date}.`
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
    edian_analyses: { used: 2, limit: 5 },
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
    expect(screen.getByText("billing.usage.edian")).toBeTruthy();
    expect(screen.getByText("billing.usage.edian: 5")).toBeTruthy();
    expect(screen.getByText("Monthly plan")).toBeTruthy();
    expect(screen.getByText("billing.comingSoon")).toBeTruthy();
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

  it("discloses the no-refund policy and links to the policy before checkout", async () => {
      vi.mocked(getBillingOverview).mockResolvedValue({
        ...trialOverview,
        checkout_available: true,
      });
      const { container } = render(
        <BillingPage businessId="business-1" membershipRole="owner" />,
      );

      expect(
        await screen.findByText(
          /All subscription payments are non-refundable/,
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole("link", {
          name: "Read the Subscription & Cancellation Policy",
        }).getAttribute("href"),
      ).toBe("/subscriptions");
      const disclosure = container.querySelector(".billing-refund-disclosure");
      const checkout = screen.getByRole("button", {
        name: /billing.upgrade/,
      });
      expect(
        Boolean(
          disclosure &&
            checkout.compareDocumentPosition(disclosure) &
              Node.DOCUMENT_POSITION_PRECEDING,
        ),
      ).toBe(true);
  });

  it("requires a Stripe-confirmed status after returning from subscription management", async () => {
      vi.mocked(getBillingOverview).mockResolvedValue({
        ...trialOverview,
        status: "active",
        current_period_end: "2026-12-01T00:00:00Z",
        cancel_at_period_end: true,
        portal_available: true,
      });
      window.history.replaceState(null, "", "/?billing=returned");
      render(<BillingPage businessId="business-1" membershipRole="owner" />);

      expect(await screen.findByText("billing.portalReturn")).toBeTruthy();
      expect(
        screen.getByText("billing.portalCancellationNotice"),
      ).toBeTruthy();
      expect(
        screen.getByText(/Stripe confirms cancellation for/),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "common.refresh" }));
      await waitFor(() =>
        expect(getBillingOverview).toHaveBeenCalledTimes(2),
      );
      expect(createBillingPortal).not.toHaveBeenCalled();
  });
});
